const express = require("express");
const router = express.Router();
const crypto = require("crypto");
const Order = require("../../models/Order");
const Brand = require("../../models/Brand");
const Plan = require("../../models/Plan");
const User = require("../../models/User");
const paymentService = require("../../services/payment");
const zinipay = require("../../services/zinipay");
const orderService = require("../../services/orderService");
const cryptomus = require("../../services/cryptomus");
const stockService = require("../../services/stockService");
const notifyAdminService = require("../../services/notifyAdmin");
const strings = require("../../bot/config/strings");
const keyboards = require("../../bot/keyboards");
const { sendReceipt } = require("../../services/receipt");
const { bot } = require("../../bot/index");

/**
 * Sends delivered credentials to the customer's Telegram chat.
 * Large quantities are split into several messages to stay under Telegram's
 * 4096-character limit.
 */
async function sendDelivery(chatId, productName, variationName, credentials, order) {
  const quantity = credentials.length;
  const chunks = [];
  let current = [];
  let length = 0;
  for (const cred of credentials) {
    if (length + cred.length > 2500 && current.length) {
      chunks.push(current);
      current = [];
      length = 0;
    }
    current.push(cred);
    length += cred.length + 1;
  }
  if (current.length) chunks.push(current);

  for (let i = 0; i < chunks.length; i++) {
    const text = strings.deliverySuccess(
      productName,
      variationName,
      chunks[i].join("\n"),
      order.orderId,
      quantity,
      chunks.length > 1 ? `${i + 1}/${chunks.length}` : "",
    );
    const isLast = i === chunks.length - 1;
    await bot.telegram.sendMessage(chatId, text, {
      parse_mode: "HTML",
      ...(isLast ? keyboards.afterDeliveryKeyboard(order.orderId) : {}),
    });
  }
}

/**
 * WooCommerce Webhook Endpoint
 * Topic: order.updated, order.created
 * URL: /webhook/woocommerce
 */
router.post("/webhook/woocommerce", async (req, res) => {
  const wooOrder = req.body;
  const topic = req.headers["x-wc-webhook-topic"] || "";
  console.log(
    `🔔 [WooCommerce Webhook] Event: ${topic}, Order #${wooOrder?.id}, Status: ${wooOrder?.status}`,
  );

  if (!wooOrder || !wooOrder.id) {
    return res.status(400).json({ status: "INVALID_PAYLOAD" });
  }

  // Acknowledge immediately to avoid WooCommerce webhook timeouts
  res.status(200).json({ received: true });

  // Verify HMAC signature if secret is configured
  const webhookSecret = process.env.WOOCOMMERCE_WEBHOOK_SECRET;
  const signature = req.headers["x-wc-webhook-signature"];
  if (webhookSecret && signature) {
    try {
      const computedSig = crypto
        .createHmac("sha256", webhookSecret)
        .update(JSON.stringify(req.body))
        .digest("base64");
      if (computedSig !== signature) {
        console.warn(
          "⚠️ [WooCommerce Webhook] Signature mismatch, proceeding cautiously.",
        );
      }
    } catch (e) {
      console.error("Signature verification error:", e.message);
    }
  }

  const paidStatuses = ["processing", "completed"];
  if (!paidStatuses.includes(wooOrder.status)) {
    // Keep a bot-created unpaid order in sync if it is cancelled on the website.
    // Never overwrite an already paid/delivered record from a non-paid event.
    if (["cancelled", "failed"].includes(wooOrder.status)) {
      await Order.findOneAndUpdate(
        {
          wooOrderId: String(wooOrder.id),
          status: { $in: ["pending", "failed", "cancelled"] },
        },
        { $set: { status: wooOrder.status } },
      );
    }
    console.log(
      `ℹ️ [WooCommerce Webhook] Order #${wooOrder.id} status is "${wooOrder.status}". No action needed.`,
    );
    return;
  }

  try {
    // 1. Locate matching Order in MongoDB
    let order = await Order.findOne({ wooOrderId: String(wooOrder.id) });

    // Fallback: check telegramId in metadata
    let telegramId = order?.telegramId;
    let telegramUsername = order?.telegramUsername;

    if (!order) {
      const tgMeta = wooOrder.meta_data?.find((m) => m.key === "_telegram_id");
      const tgUserMeta = wooOrder.meta_data?.find(
        (m) => m.key === "_telegram_username",
      );
      if (tgMeta?.value) {
        telegramId = parseInt(tgMeta.value, 10);
        telegramUsername = tgUserMeta?.value || "";

        const lineItem = wooOrder.line_items?.[0] || {};
        order = await Order.create({
          orderId: `ORD-WOO-${wooOrder.id}`,
          wooOrderId: String(wooOrder.id),
          wooProductId: lineItem.product_id || null,
          wooVariationId: lineItem.variation_id || null,
          productName: lineItem.name || "Proxy",
          variationName: lineItem.name || "",
          telegramId,
          telegramUsername,
          quantity: parseInt(lineItem.quantity, 10) || 1,
          amount: parseFloat(wooOrder.total) || 0,
          currency: wooOrder.currency || "BDT",
          status: "paid",
        });
      }
    }

    if (!order) {
      console.log(
        `ℹ️ [WooCommerce Webhook] Order #${wooOrder.id} has no associated Telegram ID.`,
      );
      return;
    }

    // Check if already delivered
    if (order.status === "delivered") {
      console.log(
        `ℹ️ [WooCommerce Webhook] Order #${wooOrder.id} already delivered.`,
      );
      return;
    }

    // 2. Mark order as paid
    order.status = "paid";
    order.gatewayResponse = wooOrder;
    await order.save();

    // 3. Atomically check and assign proxy credentials from Stock collection
    const claimedItems = await stockService.assignStockToOrder(order);

    const productName =
      order.productName || wooOrder.line_items?.[0]?.name || "Proxy";
    const variationName = order.variationName || "";

    if (claimedItems.length) {
      // Stock available -> deliver immediately
      order.status = "delivered";
      order.deliveredStockId = claimedItems[0]._id;
      order.deliveredStockIds = claimedItems.map((c) => c._id);
      order.deliveredCredentials = claimedItems
        .map((c) => c.credentials)
        .join("\n");
      order.deliveredAt = new Date();
      await order.save();

      // Update user statistics
      if (telegramId) {
        await User.findOneAndUpdate(
          { telegramId },
          {
            $inc: { totalOrders: 1, totalSpent: order.amount },
            $set: { lastActiveAt: new Date() },
          },
        );

        // Send credentials directly to user's Telegram chat
        try {
          await sendDelivery(
            telegramId,
            productName,
            variationName,
            claimedItems.map((c) => c.credentials),
            order,
          );
          console.log(
            `✅ [WooCommerce Delivery] Sent credentials to Telegram user ${telegramId} for order #${wooOrder.id}`,
          );
        } catch (tgErr) {
          console.error(
            `❌ [WooCommerce Delivery] Telegram send error to ${telegramId}:`,
            tgErr.message,
          );
        }
      }

      // Notify admin
      await notifyAdminService.notifyOrderDelivered(
        order,
        { name: productName },
        { label: variationName },
      );
    } else {
      // Out of stock in automated pool -> notify customer politely & alert admin
      order.status = "stock_pending";
      await order.save();

      console.warn(
        `⚠️ [WooCommerce Fulfillment] No pre-loaded stock for Order #${wooOrder.id}.`,
      );

      if (telegramId) {
        try {
          const waitMsg = strings.orderPaidWaiting(
            order.orderId,
            productName,
            variationName,
          );
          await bot.telegram.sendMessage(telegramId, waitMsg, {
            parse_mode: "HTML",
            ...keyboards.afterDeliveryKeyboard(),
          });
        } catch (tgErr) {
          console.error("Telegram notification error:", tgErr.message);
        }
      }

      // Alert Admin on Telegram
      await notifyAdminService.notifyWooOrderPaid(wooOrder, order);
    }

    // PDF payment memo (sent once per order, even if the webhook repeats)
    if (telegramId) {
      await sendReceipt(bot.telegram, order).catch((e) => console.error("[Receipt]", e.message));
    }
  } catch (err) {
    console.error("❌ [WooCommerce Webhook] Error processing order:", err);
  }
});

/**
 * Marks a verified payment as paid and delivers credentials from Stock.
 * Shared by every gateway. Safe to call repeatedly for the same order: the
 * order is claimed atomically, so it is delivered only once.
 *
 * @param {Object} order - Order document
 * @param {{amount?: number, expected?: number, raw?: Object, source: string}} payment - verified
 *   gateway data; `expected` is the amount due in the gateway's currency (default: order.amount)
 * @returns {Promise<"DELIVERED"|"STOCK_PENDING"|"ALREADY_PROCESSED"|"AMOUNT_MISMATCH">}
 */
async function fulfillPaidOrder(order, { amount, expected, raw, source }) {
  const due = Number(expected ?? order.amount);
  // The gateway must have collected the full order amount
  if (amount != null && !Number.isNaN(amount) && amount + 0.01 < due) {
    console.error(`❌ [${source}] Amount mismatch for ${order.orderId}: paid ${amount}, expected ${due}`);
    await Order.updateOne(
      { _id: order._id, status: "pending" },
      { $set: { status: "failed", gatewayResponse: raw || null } },
    );
    return "AMOUNT_MISMATCH";
  }

  // Claim the order atomically so a repeated notification can't deliver twice
  const claimed = await Order.findOneAndUpdate(
    { _id: order._id, status: { $in: ["pending", "failed"] } },
    { $set: { status: "paid", gatewayResponse: raw || null } },
    { new: true },
  );
  if (!claimed) {
    const current = await Order.findById(order._id).lean();
    if (current?.status === "cancelled") {
      console.error(`⚠️ [${source}] Payment received for CANCELLED order ${order.orderId} — refund or deliver manually.`);
    }
    return "ALREADY_PROCESSED";
  }
  order = claimed;

  const [brand, plan] = await Promise.all([Brand.findById(order.brandId), Plan.findById(order.planId)]);
  // The order's own names include the chosen location
  const brandName = order.productName || brand?.name || "Proxy Provider";
  const planLabel = order.variationName || plan?.label || "Proxy Plan";

  const claimedItems = await stockService.assignStockToOrder(order);

  if (claimedItems.length) {
    order.status = "delivered";
    order.deliveredStockId = claimedItems[0]._id;
    order.deliveredStockIds = claimedItems.map((c) => c._id);
    order.deliveredCredentials = claimedItems.map((c) => c.credentials).join("\n");
    order.deliveredAt = new Date();
    await order.save();

    await User.findOneAndUpdate(
      { telegramId: order.telegramId },
      { $inc: { totalOrders: 1, totalSpent: order.amount }, $set: { lastActiveAt: new Date() } },
    );

    try {
      await sendDelivery(order.telegramId, brandName, planLabel, claimedItems.map((c) => c.credentials), order);
      console.log(`✅ [${source}] Delivered ${order.orderId} to ${order.telegramId}`);
    } catch (tgErr) {
      console.error(`❌ [Fulfillment] Failed to send Telegram message:`, tgErr.message);
    }

    await sendReceipt(bot.telegram, order).catch((e) => console.error("[Receipt]", e.message));
    await notifyAdminService.notifyOrderDelivered(order, brand, plan).catch((e) => console.error("[NotifyAdmin]", e.message));
    return "DELIVERED";
  }

  order.status = "stock_pending";
  await order.save();
  try {
    await bot.telegram.sendMessage(order.telegramId, strings.outOfStockPaid(order.orderId), {
      parse_mode: "HTML",
      ...keyboards.afterDeliveryKeyboard(),
    });
  } catch (tgErr) {
    console.error(`❌ [Fulfillment] Telegram send error:`, tgErr.message);
  }
  await sendReceipt(bot.telegram, order).catch((e) => console.error("[Receipt]", e.message));
  await notifyAdminService.notifyOutOfStock(order, brand, plan).catch((e) => console.error("[NotifyAdmin]", e.message));
  return "STOCK_PENDING";
}

/**
 * Asks ZiniPay whether an order's invoice is paid and fulfils it if so.
 * ZiniPay webhooks are not signed, so the webhook payload is never trusted:
 * the status always comes from ZiniPay's verify API.
 * @returns {Promise<string>} fulfilment result, or the invoice status
 */
async function checkZiniPayOrder(order) {
  if (!order?.gatewayTransactionId || order.paymentGateway !== "zinipay") return "NOT_ZINIPAY";
  const result = await zinipay.verifyInvoice(order.gatewayTransactionId);
  if (result.status === "COMPLETED") {
    return fulfillPaidOrder(order, { amount: result.amount, raw: result.raw, source: "ZiniPay" });
  }
  if (result.status === "FAILED") {
    // Cancelled / failed invoice: keep the order, let the customer pay again
    await releaseInvoice(order, result.raw, "ZiniPay");
  }
  return result.status || "UNKNOWN";
}

/**
 * The customer cancelled (or the invoice expired / failed) without paying.
 * The order stays pending; only this invoice is dropped, so the next "Pay"
 * tap creates a fresh one. Matches on the invoice id so a newer invoice is
 * never touched.
 */
async function releaseInvoice(order, raw, source) {
  const res = await Order.updateOne(
    { _id: order._id, status: "pending", gatewayTransactionId: order.gatewayTransactionId },
    {
      $set: {
        paymentGateway: "",
        lastPaymentGateway: order.paymentGateway,
        gatewayRedirectUrl: null,
        gatewayResponse: raw || null,
      },
    },
  );
  if (res.modifiedCount) console.log(`↩️ [${source}] Invoice for ${order.orderId} was cancelled/expired — order can be paid again`);
}

/**
 * ZiniPay webhook: called after a payment update with invoice_id (query or body).
 * URL (set per invoice): <APP_BASE_URL>/webhook/zinipay?order_id=<orderId>
 */
router.all(["/webhook/zinipay", "/tg-bot/zinipay-webhook"], async (req, res) => {
  const invoiceId = String(req.body?.invoice_id || req.query.invoice_id || "");
  const orderId = String(req.query.order_id || req.body?.order_id || "");
  console.log(`🔔 [ZiniPay Webhook] invoice=${invoiceId} order=${orderId}`);

  try {
    const order = invoiceId
      ? await Order.findOne({ gatewayTransactionId: invoiceId, paymentGateway: "zinipay" })
      : orderId
        ? await Order.findOne({ orderId, paymentGateway: "zinipay" })
        : null;
    if (!order) return res.status(404).json({ status: "FAILED", message: "Order not found" });
    const status = await checkZiniPayOrder(order);
    return res.status(200).json({ status, orderId: order.orderId });
  } catch (err) {
    console.error("❌ [ZiniPay Webhook] Error:", err.message);
    return res.status(500).json({ status: "ERROR" });
  }
});

/**
 * Asks Cryptomus whether an order's invoice is paid and fulfils it if so.
 * The amount is checked in USD (what Cryptomus charged).
 */
async function checkCryptomusOrder(order) {
  if (!order?.gatewayTransactionId || order.paymentGateway !== "cryptomus") return "NOT_CRYPTOMUS";
  const inv = await cryptomus.getInvoice(order.gatewayTransactionId);
  if (inv.paid) {
    if (inv.orderId !== order.gatewayTransactionId || inv.currency !== "USD") {
      console.error(`❌ [Cryptomus] Invoice mismatch for ${order.orderId}: ${inv.orderId} ${inv.amount} ${inv.currency}`);
      return "MISMATCH";
    }
    return fulfillPaidOrder(order, { amount: inv.amount, expected: order.amountUsd, raw: inv.raw, source: "Cryptomus" });
  }
  if (inv.failed) {
    await releaseInvoice(order, inv.raw, "Cryptomus");
  } else if (inv.needsReview) {
    console.error(`⚠️ [Cryptomus] ${order.orderId}: invoice is "${inv.status}" (wrong amount paid) — review in Cryptomus and deliver or refund manually.`);
    await Order.updateOne(
      { _id: order._id, status: "pending" },
      { $set: { status: "failed", gatewayResponse: inv.raw } },
    );
  }
  return inv.status || "UNKNOWN";
}

/** Checks any pending order with whichever gateway it was paid through. */
async function checkOrderPayment(order) {
  if (order.paymentGateway === "zinipay") return checkZiniPayOrder(order);
  if (order.paymentGateway === "cryptomus") return checkCryptomusOrder(order);
  return "SKIPPED";
}

/**
 * Cryptomus webhook: POSTed on every invoice status change.
 * The signature is checked, but the status is always re-read from Cryptomus.
 */
router.post(["/webhook/cryptomus", "/tg-bot/cryptomus-webhook"], async (req, res) => {
  const body = req.body && typeof req.body === "object" ? req.body : {};
  const cryptomusId = typeof body.order_id === "string" ? body.order_id : "";
  if (!cryptomus.webhookSignatureValid(body)) {
    console.warn(`⚠️ [Cryptomus Webhook] Bad signature for order_id=${cryptomusId} from ${req.ip}`);
  }
  console.log(`🔔 [Cryptomus Webhook] order_id=${cryptomusId} status=${body.status}`);
  try {
    const order = cryptomusId
      ? await Order.findOne({ gatewayTransactionId: cryptomusId, paymentGateway: "cryptomus" })
      : null;
    if (!order) return res.status(404).json({ status: "FAILED", message: "Order not found" });
    const status = await checkCryptomusOrder(order);
    return res.status(200).json({ status, orderId: order.orderId });
  } catch (err) {
    console.error("❌ [Cryptomus Webhook] Error:", err.message);
    return res.status(500).json({ status: "ERROR" });
  }
});

/**
 * SSLCommerz IPN (Instant Payment Notification) Webhook
 * Handles server-to-server payment confirmation and instant fulfillment.
 */
router.post("/webhook/payment-ipn", async (req, res) => {
  console.log("🔔 [IPN Webhook] Received payment notification:", req.body);
  const payload = req.body;

  try {
    const verification = await paymentService.verifyPayment(payload);
    if (!verification.verified) {
      console.error("❌ [IPN Webhook] Payment verification failed:", verification.error);
      return res.status(400).json({ status: "FAILED", message: verification.error });
    }

    const tranId = verification.tranId || payload.tran_id;
    if (!tranId) {
      return res.status(400).json({ status: "FAILED", message: "Missing transaction ID" });
    }

    const order = await Order.findOne({ gatewayTransactionId: tranId });
    if (!order) {
      console.error(`❌ [IPN Webhook] Order with transaction ID ${tranId} not found.`);
      return res.status(404).json({ status: "FAILED", message: "Order not found" });
    }

    if (order.status === "delivered" || order.status === "paid") {
      console.log(`ℹ️ [IPN Webhook] Order ${order.orderId} already ${order.status}.`);
      return res.status(200).json({ status: "ALREADY_PROCESSED" });
    }

    const status = await fulfillPaidOrder(order, {
      amount: verification.amount,
      raw: verification.raw || payload,
      source: "SSLCommerz",
    });
    if (status === "AMOUNT_MISMATCH") {
      return res.status(400).json({ status: "FAILED", message: "Amount mismatch" });
    }
    return res.status(200).json({ status, orderId: order.orderId });
  } catch (err) {
    console.error("❌ [IPN Webhook] Unexpected error:", err);
    return res.status(500).json({ status: "ERROR", message: err.message });
  }
});

/**
 * GET /pay/<orderId>?m=<gateway>&t=<token> — the link behind every Pay button.
 * Paid → "payment received" page. Invoice still open → that invoice.
 * Cancelled / expired → a fresh invoice. Order cancelled → explains why.
 */
router.get("/pay/:orderId", async (req, res) => {
  const { orderId } = req.params;
  const gateway = String(req.query.m || "");
  const page = (opts) => res.status(opts.status || 200).send(renderReturnPage({ orderId, ...opts }));
  const a = Buffer.from(String(req.query.t || ""));
  const b = Buffer.from(orderService.payToken(orderId));
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return page({ status: 403, title: "Invalid link", statusText: "This payment link is not valid", subText: "Please open the order again from the Telegram bot.", isSuccess: false });
  }

  try {
    let order = await Order.findOne({ orderId });
    if (!order) {
      return page({ status: 404, title: "Order not found", statusText: "Order not found", subText: "Please place the order again from the Telegram bot.", isSuccess: false });
    }
    // Ask the gateway first: this also fulfils a paid order, or releases a dead invoice
    if (order.status === "pending" && order.paymentGateway) {
      await checkOrderPayment(order).catch((e) => console.error("[Pay link check]", e.message));
      order = await Order.findById(order._id);
    }

    if (["paid", "delivered", "stock_pending", "processing", "completed"].includes(order.status)) {
      return page({ title: "Payment received", statusText: "Payment Received!", subText: "This order is already paid. Your proxy is delivered in your Telegram chat.", isSuccess: true });
    }
    if (order.status !== "pending") {
      return page({ title: "Order closed", statusText: "This order is closed", subText: "It was cancelled or could not be completed. Please place a new order from the Telegram bot.", isSuccess: false });
    }
    // No method in the link: the checkout page asks how to pay
    if (!gateway) return res.send(renderCheckoutPage(order));

    if (order.paymentGateway && order.gatewayRedirectUrl && order.paymentGateway === gateway) {
      return res.redirect(302, order.gatewayRedirectUrl);
    }
    if (order.paymentGateway && order.paymentGateway !== gateway) {
      // Already paying with the other method: back to the page, which offers "Continue"
      return res.send(renderCheckoutPage(order));
    }
    // No open invoice (first time, or after a cancel / expiry): make a fresh one
    const { paymentUrl } = await orderService.startPayment(order.orderId, order.telegramId, gateway);
    return res.redirect(302, paymentUrl);
  } catch (err) {
    console.error(`[Pay link] ${orderId}:`, err.message);
    return page({ status: 502, title: "Payment unavailable", statusText: "Could not open the payment page", subText: err.message.replace(/^Payment link could not be created: /, "") + " — please try again in a moment.", isSuccess: false });
  }
});

const escHtml = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

/** Checkout page: order summary + one button per payment method. */
function renderCheckoutPage(order) {
  const { GATEWAYS, availableGateways, chargeFor, payLink } = orderService;
  const fmt = (c) => (c.currency === "USD" ? `$${Number(c.amount).toFixed(2)}` : `${Number(c.amount).toLocaleString("en-US", { maximumFractionDigits: 2 })} ৳`);
  const hints = { zinipay: "bKash · Nagad · Rocket", cryptomus: "USDT · BTC · ETH · TRX and more", sslcommerz: "Card · Mobile banking" };

  // Locked to a method already started: only "Continue" (one order can't be paid twice)
  const ids = order.paymentGateway ? [order.paymentGateway] : availableGateways();
  const methods = ids
    .map((id) => ({ id, ...GATEWAYS[id], charge: chargeFor(order, id) }))
    .filter((m) => m.charge.amount > 0);

  const buttons = methods
    .map(
      (m) => `<a class="method" href="${escHtml(payLink(order.orderId, m.id))}">
        <span><b>${escHtml(order.paymentGateway ? `Continue · ${m.label}` : m.label)}</b><small>${escHtml(hints[m.id] || "")}</small></span>
        <span class="amt">${escHtml(fmt(m.charge))}</span></a>`,
    )
    .join("");
  const fee = order.serviceFeePercent > 0 ? `<div class="fee">Includes ${escHtml(order.serviceFeePercent)}% service fee</div>` : "";
  const lockedNote = order.paymentGateway
    ? `<p class="note">You already started paying with ${escHtml(GATEWAYS[order.paymentGateway]?.label || order.paymentGateway)}. To use another method, cancel this order in the bot and order again.</p>`
    : "";

  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Pay · ${escHtml(order.orderId)}</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
  body { background: #0f172a; color: #f8fafc; min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 20px; }
  .card { background: #1e293b; border: 1px solid #334155; border-radius: 16px; max-width: 440px; width: 100%; padding: 26px 22px; }
  h1 { font-size: 20px; margin-bottom: 4px; }
  .sub { color: #94a3b8; font-size: 13px; margin-bottom: 18px; }
  .item { background: #0f172a; border: 1px solid #334155; border-radius: 12px; padding: 12px 14px; margin-bottom: 18px; font-size: 14px; line-height: 1.6; }
  .item b { color: #fff; }
  .q { font-size: 13px; color: #cbd5e1; margin-bottom: 10px; font-weight: 600; }
  .method { display: flex; justify-content: space-between; align-items: center; gap: 12px; text-decoration: none; color: #fff;
            background: #2563eb; border-radius: 12px; padding: 14px 16px; margin-bottom: 10px; }
  .method:nth-of-type(2) { background: #059669; }
  .method small { display: block; font-size: 12px; color: rgba(255,255,255,.8); font-weight: 400; margin-top: 2px; }
  .amt { font-weight: 800; font-size: 16px; white-space: nowrap; }
  .fee { color: #94a3b8; font-size: 12px; text-align: center; margin-top: 4px; }
  .note { color: #fbbf24; font-size: 13px; margin-top: 12px; line-height: 1.5; }
  .foot { color: #64748b; font-size: 12px; text-align: center; margin-top: 18px; line-height: 1.5; }
</style></head>
<body><div class="card">
  <h1>Choose how to pay</h1>
  <div class="sub">Order <b>${escHtml(order.orderId)}</b></div>
  <div class="item"><b>${escHtml(order.productName)}</b><br>${escHtml(order.variationName)}${order.quantity > 1 ? ` × ${escHtml(order.quantity)}` : ""}</div>
  <div class="q">Pay with</div>
  ${buttons || `<p class="note">No payment method is available right now. Please contact support.</p>`}
  ${fee}${lockedNote}
  <div class="foot">🔒 Secure checkout. Your proxy arrives in your Telegram chat as soon as the payment is confirmed.</div>
</div></body></html>`;
}

// Helper to render return page
/** https://t.me/<bot username> (cached), for "Open Telegram" buttons */
let botUrlCache = null;
async function botLink() {
  if (botUrlCache) return botUrlCache;
  const name = (process.env.BOT_USERNAME || "").replace(/^@/, "") || (await bot.telegram.getMe().then((me) => me.username).catch(() => ""));
  botUrlCache = name ? `https://t.me/${name}` : "https://t.me";
  return botUrlCache;
}

function renderReturnPage({ title, statusText, subText, isSuccess, orderId, botUrl = "https://t.me", retryUrl = null, refresh = false }) {
  const primaryColor = isSuccess ? "#10B981" : "#EF4444";
  const icon = isSuccess ? "✅" : "❌";
  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>${refresh ? '\n  <meta http-equiv="refresh" content="4">' : ""}
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
    body { background-color: #0f172a; color: #f8fafc; display: flex; align-items: center; justify-content: center; min-height: 100vh; padding: 20px; }
    .card { background-color: #1e293b; border: 1px solid #334155; border-radius: 16px; max-width: 440px; width: 100%; padding: 32px 24px; text-align: center; box-shadow: 0 10px 25px -5px rgba(0,0,0,0.5); }
    .icon { font-size: 54px; margin-bottom: 16px; }
    h1 { font-size: 22px; margin-bottom: 10px; color: ${primaryColor}; }
    p { font-size: 15px; color: #94a3b8; line-height: 1.5; margin-bottom: 20px; }
    .badge { display: inline-block; background: #0f172a; border: 1px solid #334155; padding: 6px 14px; border-radius: 8px; font-family: monospace; font-size: 13px; color: #cbd5e1; margin-bottom: 24px; }
    .btn { display: inline-block; background-color: #2563eb; color: #ffffff; text-decoration: none; padding: 12px 28px; border-radius: 10px; font-weight: 600; font-size: 15px; }
    .btn:hover { background-color: #1d4ed8; }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">${icon}</div>
    <h1>${statusText}</h1>
    <p>${subText}</p>
    ${orderId ? `<div class="badge">Order ID: ${orderId}</div><br/>` : ""}
    ${retryUrl ? `<a href="${retryUrl}" class="btn" style="background:#059669;margin-bottom:10px;display:block">💳 Pay again</a>` : ""}
    <a href="${botUrl}" class="btn">Open Telegram</a>
  </div>
</body>
</html>
  `;
}

// Payment Redirection Routes
// Also reachable as https://<shop domain>/tg-bot/paid (nginx), because gateways
// only accept return URLs on the shop's own domain.
router.all(["/payment/success", "/tg-bot/paid"], async (req, res) => {
  const orderId = String(req.query.order_id || req.body?.value_a || "");
  let order = orderId ? await Order.findOne({ orderId }).catch(() => null) : null;
  // Confirm with the gateway right now instead of waiting for its webhook / the poll
  if (order?.status === "pending" && order.paymentGateway) {
    await checkOrderPayment(order).catch((e) => console.error("[Success check]", e.message));
    order = await Order.findById(order._id).catch(() => order);
  }
  const bot = await botLink();
  const s = order?.status;
  const paid = ["delivered", "paid", "stock_pending", "processing", "completed"].includes(s);
  let view;
  if (s === "delivered") {
    view = { statusText: "Payment received ✅", subText: "Your proxy has been sent to your Telegram chat." };
  } else if (paid) {
    view = { statusText: "Payment received ✅", subText: "We're preparing your proxy — it will arrive in your Telegram chat shortly." };
  } else if (s === "pending" && order.paymentGateway) {
    // Invoice still open: the gateway may need a few seconds to confirm
    view = { statusText: "Confirming your payment…", subText: "This usually takes a few seconds. Your proxy will appear in your Telegram chat as soon as it's confirmed.", refresh: true };
  } else if (s === "pending") {
    // The invoice was cancelled / expired without payment
    view = { statusText: "Payment not completed", subText: "No money was taken. You can pay again whenever you're ready.", retryUrl: orderService.payLink(order.orderId) };
  } else if (order) {
    view = { statusText: "This order is closed", subText: "It was cancelled or could not be completed. Please place a new order in the Telegram bot." };
  } else {
    view = { statusText: "Order not found", subText: "Please open your order from the Telegram bot." };
  }
  res.send(renderReturnPage({ title: "Payment", isSuccess: paid || Boolean(view.refresh), orderId, botUrl: bot, ...view }));
});

router.all("/payment/fail", (req, res) => {
  const orderId = req.query.order_id || req.body?.value_a || "";
  res.send(
    renderReturnPage({
      title: "Payment Failed",
      statusText: "Payment Was Not Completed",
      subText:
        "Your transaction could not be processed. You can retry anytime via Telegram.",
      isSuccess: false,
      orderId,
    }),
  );
});

router.all(["/payment/cancel", "/tg-bot/cancel"], async (req, res) => {
  const orderId = String(req.query.order_id || req.body?.value_a || "");
  let order = orderId ? await Order.findOne({ orderId }).catch(() => null) : null;
  // Drop the cancelled invoice now (or deliver, if it was actually paid)
  if (order?.status === "pending" && order.paymentGateway) {
    await checkOrderPayment(order).catch((e) => console.error("[Cancel check]", e.message));
    order = await Order.findById(order._id).catch(() => order);
  }
  if (order && ["delivered", "paid", "stock_pending"].includes(order.status)) {
    return res.redirect(302, `/payment/success?order_id=${encodeURIComponent(orderId)}`);
  }
  res.send(
    renderReturnPage({
      title: "Payment Cancelled",
      statusText: "Payment Cancelled",
      subText: "No money was taken. You can pay again whenever you're ready.",
      isSuccess: false,
      orderId,
      botUrl: await botLink(),
      retryUrl: order?.status === "pending" ? orderService.payLink(order.orderId) : null,
    }),
  );
});

module.exports = router;
module.exports.fulfillPaidOrder = fulfillPaidOrder;
module.exports.checkZiniPayOrder = checkZiniPayOrder;
module.exports.checkCryptomusOrder = checkCryptomusOrder;
module.exports.checkOrderPayment = checkOrderPayment;
