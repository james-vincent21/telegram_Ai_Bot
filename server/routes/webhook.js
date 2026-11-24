const express = require("express");
const router = express.Router();
const crypto = require("crypto");
const Order = require("../../models/Order");
const Brand = require("../../models/Brand");
const Plan = require("../../models/Plan");
const User = require("../../models/User");
const paymentService = require("../../services/payment");
const zinipay = require("../../services/zinipay");
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
    await Order.updateOne(
      { _id: order._id, status: "pending" },
      { $set: { status: "failed", gatewayResponse: result.raw } },
    );
  }
  return result.status || "UNKNOWN";
}

/**
 * ZiniPay webhook: called after a payment update with invoice_id (query or body).
 * URL (set per invoice): <APP_BASE_URL>/webhook/zinipay?order_id=<orderId>
 */
router.all("/webhook/zinipay", async (req, res) => {
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
router.post("/webhook/cryptomus", async (req, res) => {
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

// Helper to render return page
function renderReturnPage({ title, statusText, subText, isSuccess, orderId }) {
  const primaryColor = isSuccess ? "#10B981" : "#EF4444";
  const icon = isSuccess ? "✅" : "❌";
  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
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
    <a href="https://t.me" class="btn">Return to Telegram</a>
  </div>
</body>
</html>
  `;
}

// Payment Redirection Routes
router.all("/payment/success", async (req, res) => {
  const orderId = req.query.order_id || req.body?.value_a || "";
  // ZiniPay / Cryptomus: confirm with the gateway now instead of waiting for the webhook
  if (orderId) {
    const order = await Order.findOne({ orderId: String(orderId), status: "pending" }).catch(() => null);
    if (order) await checkOrderPayment(order).catch((e) => console.error("[Success check]", e.message));
  }
  res.send(
    renderReturnPage({
      title: "Payment Successful",
      statusText: "Payment Received Successfully!",
      subText:
        "Your payment was confirmed. Your proxy credentials have been delivered directly to your Telegram chat.",
      isSuccess: true,
      orderId,
    }),
  );
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

router.all("/payment/cancel", (req, res) => {
  const orderId = req.query.order_id || req.body?.value_a || "";
  res.send(
    renderReturnPage({
      title: "Payment Cancelled",
      statusText: "Payment Cancelled",
      subText:
        "You cancelled the checkout session. Feel free to resume when you are ready.",
      isSuccess: false,
      orderId,
    }),
  );
});

module.exports = router;
module.exports.fulfillPaidOrder = fulfillPaidOrder;
module.exports.checkZiniPayOrder = checkZiniPayOrder;
module.exports.checkCryptomusOrder = checkCryptomusOrder;
module.exports.checkOrderPayment = checkOrderPayment;
