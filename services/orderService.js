/**
 * Shared order logic for the Telegram bot and the Mini App shop.
 *
 * Products come from ipdokan.com. An order is created first; the customer then
 * picks a payment method (startPayment). Once the gateway confirms payment
 * (server/routes/webhook.js), credentials are claimed from Stock and sent to
 * the customer's Telegram chat.
 */
const crypto = require("crypto");
const Order = require("../models/Order");
const catalog = require("./ipdokan");
const paymentService = require("./payment");
const zinipay = require("./zinipay");
const cryptomus = require("./cryptomus");

/** Payment methods shown to customers, in display order. */
const GATEWAYS = {
  zinipay: { label: "💳 bKash / Nagad", currency: "BDT", configured: () => zinipay.isConfigured() },
  cryptomus: { label: "🪙 Crypto (USDT)", currency: "USD", configured: () => cryptomus.isConfigured() },
  sslcommerz: {
    label: "💳 Card / Mobile banking",
    currency: "BDT",
    // Fallback only when ZiniPay isn't set up
    configured: () => !zinipay.isConfigured() && Boolean(process.env.GATEWAY_STORE_ID && process.env.GATEWAY_STORE_PASSWORD),
  },
};

/** Configured payment methods, e.g. ["zinipay", "cryptomus"]. */
function availableGateways() {
  return Object.keys(GATEWAYS).filter((g) => GATEWAYS[g].configured());
}

/** Signature for the bot's own /pay/<orderId> link (so strangers can't open other people's orders). */
function payToken(orderId) {
  const secret = process.env.JWT_SECRET || process.env.BOT_TOKEN || "ipdokan-bot";
  return crypto.createHmac("sha256", secret).update(`pay:${orderId}`).digest("hex").slice(0, 20);
}

/**
 * The link behind every "Pay" button: <APP_BASE_URL>/pay/<orderId>?m=<gateway>&t=<token>.
 * Each visit re-checks the invoice and, if the customer cancelled or it
 * expired, makes a fresh one, so the same button always works.
 */
function payLink(orderId, gateway = "") {
  const base = (process.env.APP_BASE_URL || "http://localhost:5001").replace(/\/$/, "");
  const m = gateway ? `m=${encodeURIComponent(gateway)}&` : "";
  return `${base}/pay/${encodeURIComponent(orderId)}?${m}t=${payToken(orderId)}`;
}

/** Amount + currency an order is charged in with a given gateway. */
function chargeFor(order, gateway) {
  return GATEWAYS[gateway]?.currency === "USD"
    ? { amount: order.amountUsd, currency: "USD" }
    : { amount: order.amount, currency: order.currency || "BDT" };
}

const MAX_QUANTITY = 50;

const roundMoney = (v) => Math.round(Number(v) * 100) / 100;

/** Same as ipdokan.com: fee = round(subtotal × p%), total = subtotal + fee. */
function withServiceFee(subtotal, percent) {
  const base = roundMoney(subtotal);
  const serviceFee = roundMoney((base * percent) / 100);
  return { subtotal: base, serviceFee, total: roundMoney(base + serviceFee) };
}

/**
 * Resolves product + selected package (variationId 0/null = simple product).
 * variationId may be the full ipdokan id or the short id used in buttons.
 */
async function resolveItem(productId, variationId, prefetched = {}) {
  const product = prefetched.product || (await catalog.getProduct(productId));
  if (!variationId || String(variationId) === "0") {
    return {
      product,
      variation: null,
      name: "Standard",
      price: parseFloat(product.price) || 0,
      priceUsd: product.priceUsd != null ? Number(product.priceUsd) : null,
      inStock: product.stock_status === "instock",
      stockQuantity: product.stock_quantity ?? null,
      chooseLocation: false,
    };
  }
  const variation = await catalog.getVariation(product.id, variationId);
  if (!variation) return null;
  return {
    product,
    variation,
    name: variation.name,
    price: parseFloat(variation.price) || 0,
    priceUsd: variation.priceUsd != null ? Number(variation.priceUsd) : null,
    inStock: variation.inStock,
    stockQuantity: variation.stockQuantity ?? null,
    chooseLocation: variation.chooseLocation,
  };
}

function maxQuantity(item) {
  return item.stockQuantity > 0 ? Math.min(MAX_QUANTITY, item.stockQuantity) : MAX_QUANTITY;
}

/** "1 IP · 1 Month · 📍 United Kingdom · London" */
function packageLabel(name, location) {
  return location ? `${name} · 📍 ${location.name}` : name;
}

function newOrderId() {
  const timestamp = Date.now().toString().slice(-6);
  const randomSuffix = Math.floor(1000 + Math.random() * 9000);
  return `ORD-${timestamp}-${randomSuffix}`;
}

class OrderError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code; // "not_found" | "out_of_stock" | "location_required" | "gateway" | "not_pending"
  }
}

/**
 * Checks the chosen location for a package that needs one.
 * @returns {Promise<{id,name,stock,inStock}|null>} null when the package has no locations
 */
async function resolveLocation(item, locationId) {
  if (!item.chooseLocation) return null;
  if (!locationId || String(locationId) === "0") {
    throw new OrderError("location_required", "Please choose a location first.");
  }
  const location = await catalog.getLocation(item.product.id, locationId);
  if (!location) throw new OrderError("not_found", "This location could not be found.");
  if (!location.inStock) throw new OrderError("out_of_stock", "This location is sold out.");
  return location;
}

/**
 * Creates the local Order (unpaid, no payment method yet) for a Telegram user.
 * @param {{id:number, username?:string, first_name?:string}} from - Telegram user
 * @returns {Promise<{order, item, location, total:number}>}
 */
async function createTelegramOrder({ from, productId, variationId, quantity, locationId, source = "bot" }) {
  const vid = variationId && String(variationId) !== "0" ? String(variationId) : null;
  const item = await resolveItem(productId, vid);
  if (!item) throw new OrderError("not_found", "This package could not be found.");
  if (!item.inStock) throw new OrderError("out_of_stock", "This package is sold out.");
  const location = await resolveLocation(item, locationId);

  const qty = Math.min(maxQuantity(item), Math.max(1, parseInt(quantity, 10) || 1));
  const { product, variation } = item;
  const orderId = newOrderId();
  const feePercent = await catalog.getServiceFeePercent();
  const bdt = withServiceFee(item.price * qty, feePercent);
  const usd = item.priceUsd > 0 ? withServiceFee(item.priceUsd * qty, feePercent) : null;
  const total = bdt.total;
  const { brand, plan } = await catalog.ensureBrandPlan(product.id, variation?.id);

  const order = await Order.create({
    orderId,
    wooProductId: product.id,
    wooVariationId: variation?.id || null,
    brandId: brand?._id,
    planId: plan?._id,
    locationId: location?.id || null,
    locationName: location?.name || "",
    productName: product.name,
    variationName: packageLabel(item.name, location),
    proxyType: /\bGB\b/i.test(`${product.name} ${item.name}`) ? "gb" : "ip",
    telegramId: from.id,
    telegramUsername: from.username || "",
    telegramFirstName: from.first_name || "",
    quantity: qty,
    unitPrice: item.price,
    subtotal: bdt.subtotal,
    serviceFee: bdt.serviceFee,
    serviceFeePercent: feePercent,
    amount: bdt.total,
    unitPriceUsd: item.priceUsd,
    subtotalUsd: usd?.subtotal ?? null,
    serviceFeeUsd: usd?.serviceFee ?? null,
    amountUsd: usd?.total ?? null,
    currency: "BDT",
    status: "pending",
  });
  console.log(`[Order ${source}] Created ${orderId}: ${product.name} / ${order.variationName} ×${qty} = ${bdt.subtotal} + ${bdt.serviceFee} fee = ${total} BDT`);

  return { order, item, location, total };
}

/**
 * Starts (or resumes) payment for a pending order with the chosen gateway and
 * returns its checkout link. An order is locked to the first gateway it is
 * started with, so the customer can never pay the same order twice.
 * @returns {Promise<{order, paymentUrl: string, amount: number, currency: string}>}
 */
async function startPayment(orderId, telegramId, gateway) {
  if (!GATEWAYS[gateway] || !GATEWAYS[gateway].configured()) {
    throw new OrderError("gateway", "This payment method is not available.");
  }
  let order = await Order.findOne({ orderId: String(orderId), telegramId });
  if (!order) throw new OrderError("not_found", "This order could not be found.");
  if (order.status !== "pending") throw new OrderError("not_pending", "This order is no longer waiting for payment.");

  if (order.paymentGateway && order.paymentGateway !== gateway) {
    throw new OrderError(
      "gateway",
      `Payment for this order was already started with ${GATEWAYS[order.paymentGateway]?.label || order.paymentGateway}. Use that link, or cancel and order again.`,
    );
  }
  const charge = chargeFor(order, gateway);
  if (!(charge.amount > 0)) throw new OrderError("gateway", "This product has no price for this payment method.");
  if (order.paymentGateway === gateway && order.gatewayRedirectUrl) {
    return { order, paymentUrl: order.gatewayRedirectUrl, ...charge };
  }

  // Lock the gateway first (atomically) so two taps can't create two invoices
  order = await Order.findOneAndUpdate(
    { _id: order._id, status: "pending", paymentGateway: { $in: ["", null] } },
    {
      $set: {
        paymentGateway: gateway,
        // SSLCommerz uses this as tran_id; ZiniPay / Cryptomus replace it below
        gatewayTransactionId: `${order.orderId}-${crypto.randomBytes(4).toString("hex")}`,
      },
    },
    { new: true },
  );
  if (!order) return startPayment(orderId, telegramId, gateway); // another tap won the race

  const customer = { name: order.telegramFirstName || order.telegramUsername || `User ${order.telegramId}` };
  let session;
  try {
    if (gateway === "zinipay") session = await zinipay.createInvoice(order, customer);
    else if (gateway === "cryptomus") session = await cryptomus.createInvoice(order);
    else session = await paymentService.createPaymentSession(order, customer);
  } catch (err) {
    session = { success: false, error: err.message };
  }
  if (!session.success || !session.redirectUrl) {
    // Unlock so the customer can retry or pick another method
    await Order.updateOne(
      { _id: order._id, status: "pending" },
      { $set: { paymentGateway: "", gatewayResponse: session.raw || { error: session.error } } },
    );
    console.error(`[Payment] ${gateway} invoice failed for ${order.orderId}:`, session.error);
    throw new Error(`Payment link could not be created: ${session.error}`);
  }

  order.gatewayRedirectUrl = session.redirectUrl;
  if (session.invoiceId && gateway !== "sslcommerz") order.gatewayTransactionId = session.invoiceId;
  await order.save();
  console.log(`[Payment] ${gateway} invoice for ${order.orderId}: ${charge.amount} ${charge.currency}`);
  return { order, paymentUrl: session.redirectUrl, ...charge };
}

module.exports = {
  MAX_QUANTITY,
  GATEWAYS,
  resolveItem,
  maxQuantity,
  packageLabel,
  withServiceFee,
  availableGateways,
  chargeFor,
  createTelegramOrder,
  startPayment,
  payLink,
  payToken,
  OrderError,
};
