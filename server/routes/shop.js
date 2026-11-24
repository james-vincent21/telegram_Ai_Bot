/**
 * API for the Telegram Mini App shop (server/public/shop).
 * Every request must carry Telegram's signed initData, which proves who the
 * user is. No admin token is involved.
 */
const express = require("express");
const crypto = require("crypto");
const router = express.Router();

const Order = require("../../models/Order");
const catalog = require("../../services/ipdokan");
const {
  createTelegramOrder,
  startPayment,
  payLink,
  availableGateways,
  GATEWAYS,
  OrderError,
  MAX_QUANTITY,
} = require("../../services/orderService");

/** Payment methods this order can use: [{id, label, amount, currency}] */
function methodsFor(order) {
  return availableGateways()
    .map((id) => ({ id, label: GATEWAYS[id].label, currency: GATEWAYS[id].currency }))
    .map((m) => ({ ...m, amount: m.currency === "USD" ? order.amountUsd : order.amount }))
    .filter((m) => m.amount > 0);
}
const strings = require("../../bot/config/strings");
const keyboards = require("../../bot/keyboards");
const { bot } = require("../../bot/index");

const MAX_AGE_SECONDS = 24 * 60 * 60;

/** Verifies Telegram WebApp initData (https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app) */
function verifyInitData(initData, botToken) {
  if (!initData || !botToken) return null;
  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  if (!hash) return null;
  params.delete("hash");
  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");
  const secret = crypto.createHmac("sha256", "WebAppData").update(botToken).digest();
  const expected = crypto.createHmac("sha256", secret).update(dataCheckString).digest("hex");
  const a = Buffer.from(expected, "hex");
  const b = Buffer.from(hash, "hex");
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

  const authDate = parseInt(params.get("auth_date") || "0", 10);
  if (!authDate || Date.now() / 1000 - authDate > MAX_AGE_SECONDS) return null;
  try {
    const user = JSON.parse(params.get("user") || "null");
    return user && user.id ? user : null;
  } catch {
    return null;
  }
}

router.use((req, res, next) => {
  const user = verifyInitData(req.get("X-Telegram-Init-Data"), process.env.BOT_TOKEN);
  if (!user) return res.status(401).json({ error: "Please open the shop from the Telegram bot." });
  req.tgUser = user;
  next();
});

// Categories with their products
router.get("/catalog", async (req, res) => {
  try {
    const categories = await catalog.getCategories();
    const withProducts = await Promise.all(
      categories.map(async (c) => {
        const products = await catalog.getProductsByCategory(c.id).catch(() => []);
        return {
          id: c.id,
          name: c.name,
          emoji: c.emoji,
          products: products.map((p) => ({
            id: p.id,
            name: p.name,
            price: parseFloat(p.price) || 0,
            image: p.image,
            inStock: p.inStock,
            hasVariations: p.hasVariations,
          })),
        };
      }),
    );
    return res.json({
      categories: withProducts.filter((c) => c.products.length),
      serviceFeePercent: await catalog.getServiceFeePercent(),
    });
  } catch (err) {
    console.error("[Shop] catalog:", err.message);
    return res.status(502).json({ error: "Could not load the store. Please try again." });
  }
});

// One product with its packages
router.get("/products/:id", async (req, res) => {
  try {
    const [product, variations] = await Promise.all([
      catalog.getProduct(req.params.id),
      catalog.getProductVariations(req.params.id).catch(() => []),
    ]);
    const packages = variations.length
      ? variations.map((v) => ({
          id: v.id,
          name: v.name,
          price: parseFloat(v.price) || 0,
          inStock: Boolean(v.inStock) && v.stockQuantity !== 0,
          stock: v.stockQuantity ?? null,
          chooseLocation: Boolean(v.chooseLocation),
        }))
      : [
          {
            id: 0,
            name: "Standard",
            price: parseFloat(product.price) || 0,
            inStock: product.stock_status === "instock" && product.stock_quantity !== 0,
            stock: product.stock_quantity ?? null,
            chooseLocation: false,
          },
        ];
    return res.json({
      id: product.id,
      name: product.name,
      image: product.images?.[0]?.src || "",
      description: String(product.short_description || "").replace(/<[^>]+>/g, "").trim().slice(0, 400),
      maxQuantity: MAX_QUANTITY,
      serviceFeePercent: await catalog.getServiceFeePercent(),
      locations: (product.locations || []).map((l) => ({ id: l.id, name: l.name, stock: l.stock, inStock: l.inStock })),
      packages,
    });
  } catch (err) {
    console.error("[Shop] product:", err.message);
    return res.status(502).json({ error: "Could not load this product." });
  }
});

// Place an order → returns the payment methods to choose from
router.post("/orders", async (req, res) => {
  const { productId, variationId, quantity, locationId } = req.body || {};
  if (!/^[a-f0-9]{1,24}$/i.test(String(productId))) return res.status(400).json({ error: "Invalid product" });
  if (locationId != null && !/^[A-Za-z0-9-]{1,32}$/.test(String(locationId))) {
    return res.status(400).json({ error: "Invalid location" });
  }
  try {
    const { order, total } = await createTelegramOrder({
      from: req.tgUser,
      productId: String(productId),
      variationId: variationId ? String(variationId) : null,
      quantity,
      locationId: locationId != null ? String(locationId) : null,
      source: "shop",
    });

    const methods = methodsFor(order);

    const checkoutUrl = payLink(order.orderId);
    const totals = [`${order.amount} ৳`, ...(methods.some((m) => m.currency === "USD") ? [`$${order.amountUsd}`] : [])].join(" / ");

    // Also drop the order + Pay Now button into the chat, so it's never lost
    bot.telegram
      .sendMessage(
        req.tgUser.id,
        strings
          .checkoutReady(order.productName, order.variationName, order.orderId, order.quantity, totals, order.serviceFeePercent)
          .replace(/%%STEPS:\d%%\n?/, ""),
        { parse_mode: "HTML", ...keyboards.checkoutKeyboard(checkoutUrl, order.orderId, totals) },
      )
      .catch(() => {});

    return res.json({ orderId: order.orderId, total, currency: "BDT", totalUsd: order.amountUsd, methods, checkoutUrl });
  } catch (err) {
    if (err instanceof OrderError) return res.status(409).json({ error: err.message });
    console.error("[Shop] order:", err.message);
    return res.status(502).json({ error: "Could not create the order. Nothing was charged." });
  }
});

// Start payment for one of the user's orders with a method → returns the checkout link
router.post("/orders/:orderId/pay", async (req, res) => {
  const method = String(req.body?.method || "");
  if (!GATEWAYS[method]) return res.status(400).json({ error: "Invalid payment method" });
  try {
    const ip = String(req.get("x-real-ip") || "").trim();
    const { amount, currency } = await startPayment(req.params.orderId, req.tgUser.id, method, 0, { ip });
    return res.json({ paymentUrl: payLink(req.params.orderId, method), amount, currency });
  } catch (err) {
    if (err instanceof OrderError) return res.status(409).json({ error: err.message });
    console.error("[Shop] pay:", err.message);
    return res.status(502).json({ error: "Could not start the payment. Nothing was charged." });
  }
});

// The user's own orders
router.get("/orders", async (req, res) => {
  try {
    const orders = await Order.find({ telegramId: req.tgUser.id })
      .sort({ createdAt: -1 })
      .limit(20)
      .select("orderId paymentGateway lastPaymentGateway amountUsd productName variationName locationName quantity amount currency status createdAt expiresAt deliveredCredentials gatewayRedirectUrl");
    return res.json({
      orders: orders.map((o) => ({
        ...o.toObject(),
        gatewayRedirectUrl: undefined,
        // Pending orders: the checkout page (asks how to pay, or "Continue")
        payLink: o.status === "pending" ? payLink(o.orderId) : null,
      })),
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

module.exports = router;
module.exports.verifyInitData = verifyInitData;
