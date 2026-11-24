/**
 * Shared order logic for the Telegram bot and the Mini App shop.
 *
 * Products come from ipdokan.com. Payment is taken with SSLCommerz; when its
 * IPN confirms payment (server/routes/webhook.js), credentials are claimed
 * from Stock and sent to the customer's Telegram chat.
 */
const crypto = require("crypto");
const Order = require("../models/Order");
const catalog = require("./ipdokan");
const paymentService = require("./payment");

const MAX_QUANTITY = 50;

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
    this.code = code; // "not_found" | "out_of_stock" | "location_required"
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
 * Creates the local Order and its SSLCommerz payment link for a Telegram user.
 * @param {{id:number, username?:string, first_name?:string}} from - Telegram user
 * @returns {Promise<{order, item, location, total:number, paymentUrl:string}>}
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
  const total = Math.round(item.price * qty * 100) / 100;
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
    amount: total,
    currency: "BDT",
    gatewayTransactionId: `${orderId}-${crypto.randomBytes(4).toString("hex")}`,
    status: "pending",
  });

  let session;
  try {
    session = await paymentService.createPaymentSession(order, {
      name: from.first_name || from.username || `User ${from.id}`,
    });
  } catch (err) {
    session = { success: false, error: err.message };
  }
  if (!session.success || !session.redirectUrl) {
    order.status = "failed";
    order.gatewayResponse = session.raw || { error: session.error };
    await order.save();
    console.error(`[Order ${source}] Payment session failed for ${orderId}:`, session.error);
    throw new Error(`Payment link could not be created: ${session.error}`);
  }

  order.gatewayRedirectUrl = session.redirectUrl;
  await order.save();

  return { order, item, location, total, paymentUrl: session.redirectUrl };
}

module.exports = {
  MAX_QUANTITY,
  resolveItem,
  maxQuantity,
  packageLabel,
  createTelegramOrder,
  OrderError,
};
