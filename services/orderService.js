/**
 * Shared order logic for the Telegram bot and the Mini App shop.
 */
const Order = require("../models/Order");
const woocommerce = require("./woocommerce");

const MAX_QUANTITY = 50;

/** Resolves product + selected package (variationId 0/null = simple product). */
async function resolveItem(productId, variationId, prefetched = {}) {
  const product = prefetched.product || (await woocommerce.getProduct(productId));
  if (!variationId || String(variationId) === "0") {
    return {
      product,
      name: "Standard",
      price: parseFloat(product.price) || 0,
      inStock: product.stock_status === "instock",
      stockQuantity: product.stock_quantity ?? null,
    };
  }
  const variations = await woocommerce.getProductVariations(productId);
  const selectedVar = variations.find((v) => String(v.id) === String(variationId));
  if (!selectedVar) return null;
  return {
    product,
    name: selectedVar.name,
    price: parseFloat(selectedVar.price) || 0,
    inStock: selectedVar.inStock,
    stockQuantity: selectedVar.stockQuantity ?? null,
  };
}

function maxQuantity(item) {
  return item.stockQuantity > 0 ? Math.min(MAX_QUANTITY, item.stockQuantity) : MAX_QUANTITY;
}

function newOrderId() {
  const timestamp = Date.now().toString().slice(-6);
  const randomSuffix = Math.floor(1000 + Math.random() * 9000);
  return `ORD-${timestamp}-${randomSuffix}`;
}

class OrderError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code; // "not_found" | "out_of_stock"
  }
}

/**
 * Creates the WooCommerce order + local Order for a Telegram user.
 * @param {{id:number, username?:string, first_name?:string}} from - Telegram user
 * @returns {Promise<{order, item, total:number, paymentUrl:string}>}
 */
async function createTelegramOrder({ from, productId, variationId, quantity, source = "bot" }) {
  const vid = variationId && String(variationId) !== "0" ? String(variationId) : null;
  const item = await resolveItem(productId, vid);
  if (!item) throw new OrderError("not_found", "This package could not be found.");
  if (!item.inStock) throw new OrderError("out_of_stock", "This package is sold out.");

  const qty = Math.min(maxQuantity(item), Math.max(1, parseInt(quantity, 10) || 1));
  const { product } = item;
  const orderId = newOrderId();
  const total = Math.round(item.price * qty * 100) / 100;

  const wooResult = await woocommerce.createOrder({
    telegramId: from.id,
    telegramUsername: from.username || "",
    firstName: from.first_name || "",
    productId,
    variationId: vid,
    quantity: qty,
    note: `Order from Telegram${source === "shop" ? " Mini App" : ""}: @${from.username || from.id}`,
  });

  const order = await Order.create({
    orderId,
    wooOrderId: String(wooResult.id),
    wooProductId: parseInt(productId, 10),
    wooVariationId: vid ? parseInt(vid, 10) : null,
    productName: product.name,
    variationName: item.name,
    proxyType: product.name.toUpperCase().includes("GB") ? "gb" : "ip",
    telegramId: from.id,
    telegramUsername: from.username || "",
    telegramFirstName: from.first_name || "",
    quantity: qty,
    unitPrice: item.price,
    amount: total,
    currency: "BDT",
    gatewayRedirectUrl: wooResult.paymentUrl,
    status: "pending",
  });

  return { order, item, total, paymentUrl: wooResult.paymentUrl };
}

module.exports = {
  MAX_QUANTITY,
  resolveItem,
  maxQuantity,
  createTelegramOrder,
  OrderError,
};
