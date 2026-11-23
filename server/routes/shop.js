/**
 * API for the Telegram Mini App shop (server/public/shop).
 * Every request must carry Telegram's signed initData, which proves who the
 * user is. No admin token is involved.
 */
const express = require("express");
const crypto = require("crypto");
const router = express.Router();

const Order = require("../../models/Order");
const woocommerce = require("../../services/woocommerce");
const { createTelegramOrder, OrderError, MAX_QUANTITY } = require("../../services/orderService");
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
    const categories = await woocommerce.getCategories();
    const withProducts = await Promise.all(
      categories.map(async (c) => {
        const products = await woocommerce.getProductsByCategory(c.id).catch(() => []);
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
    return res.json({ categories: withProducts.filter((c) => c.products.length) });
  } catch (err) {
    console.error("[Shop] catalog:", err.message);
    return res.status(502).json({ error: "Could not load the store. Please try again." });
  }
});

// One product with its packages
router.get("/products/:id", async (req, res) => {
  try {
    const [product, variations] = await Promise.all([
      woocommerce.getProduct(req.params.id),
      woocommerce.getProductVariations(req.params.id).catch(() => []),
    ]);
    const packages = variations.length
      ? variations.map((v) => ({
          id: v.id,
          name: v.name,
          price: parseFloat(v.price) || 0,
          inStock: Boolean(v.inStock) && v.stockQuantity !== 0,
          stock: v.stockQuantity ?? null,
        }))
      : [
          {
            id: 0,
            name: "Standard",
            price: parseFloat(product.price) || 0,
            inStock: product.stock_status === "instock" && product.stock_quantity !== 0,
            stock: product.stock_quantity ?? null,
          },
        ];
    return res.json({
      id: product.id,
      name: product.name,
      image: product.images?.[0]?.src || "",
      description: String(product.short_description || "").replace(/<[^>]+>/g, "").trim().slice(0, 400),
      maxQuantity: MAX_QUANTITY,
      packages,
    });
  } catch (err) {
    console.error("[Shop] product:", err.message);
    return res.status(502).json({ error: "Could not load this product." });
  }
});

// Place an order → returns the payment link
router.post("/orders", async (req, res) => {
  const { productId, variationId, quantity } = req.body || {};
  if (!/^\d+$/.test(String(productId))) return res.status(400).json({ error: "Invalid product" });
  try {
    const { order, item, total, paymentUrl } = await createTelegramOrder({
      from: req.tgUser,
      productId: String(productId),
      variationId: variationId ? String(variationId) : null,
      quantity,
      source: "shop",
    });

    // Also drop the order + pay button into the chat, so it's never lost
    bot.telegram
      .sendMessage(
        req.tgUser.id,
        strings.orderSummary(item.product.name, item.name, total, "BDT", order.orderId, order.quantity).replace(/%%STEPS:\d%%\n?/, ""),
        { parse_mode: "HTML", ...keyboards.orderPaymentKeyboard(paymentUrl, order.orderId, total, "BDT") },
      )
      .catch(() => {});

    return res.json({ orderId: order.orderId, total, currency: "BDT", paymentUrl });
  } catch (err) {
    if (err instanceof OrderError) return res.status(409).json({ error: err.message });
    console.error("[Shop] order:", err.message);
    return res.status(502).json({ error: "Could not create the order. Nothing was charged." });
  }
});

// The user's own orders
router.get("/orders", async (req, res) => {
  try {
    const orders = await Order.find({ telegramId: req.tgUser.id })
      .sort({ createdAt: -1 })
      .limit(20)
      .select("orderId productName variationName quantity amount currency status createdAt expiresAt deliveredCredentials gatewayRedirectUrl");
    return res.json({ orders });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

module.exports = router;
module.exports.verifyInitData = verifyInitData;
