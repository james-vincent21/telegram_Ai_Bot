// Bridge for the IPDokan Telegram bot (/opt/ipdokan), so bot sales use this
// store's own inventory and order flow:
//   POST /api/bot/orders            create an order for a Telegram user (reserves codes / supplier plan)
//   POST /api/bot/orders/:id/started customer was sent to a payment page (keeps the reservation alive)
//   POST /api/bot/orders/:id/paid    payment verified by the bot -> codes sold + returned
//   POST /api/bot/orders/:id/cancel  release the reservation
//   GET  /api/bot/orders/:id         status + delivered codes (supplier orders can arrive later)
//
// Security: requires the X-Bot-Secret header (BOT_API_SECRET in .env) and is
// only accepted on direct local connections (127.0.0.1:4000). Anything that
// came through nginx carries X-Real-IP / X-Forwarded-For and is refused.
import { Router } from "express";
import mongoose from "mongoose";
import { timingSafeEqual } from "node:crypto";
import { Order } from "../models/order.model.js";
import { cancelOrder, createOrder, fulfillPaidOrder } from "../controllers/store.controller.js";

const router = Router();
const LOOPBACK = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);

router.use((req, res, next) => {
  const secret = process.env.BOT_API_SECRET || "";
  if (secret.length < 32) return res.status(503).json({ error: "Bot bridge is not configured." });
  const proxied = req.headers["x-real-ip"] || req.headers["x-forwarded-for"];
  if (proxied || !LOOPBACK.has(req.socket?.remoteAddress || "")) return res.status(404).json({ error: "Route not found." });
  const given = Buffer.from(String(req.headers["x-bot-secret"] || ""));
  const expected = Buffer.from(secret);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return res.status(401).json({ error: "Unauthorized." });
  next();
});

const telegramUser = (body) => {
  const id = String(body?.telegramId || "").replace(/\D/g, "");
  return id ? { id: `telegram:${id}`, name: String(body?.name || `Telegram ${id}`).slice(0, 80), email: `tg${id}@telegram.ipdokan.com` } : null;
};

const view = (order) => ({
  id: String(order._id),
  status: order.status,
  amount: order.amount,
  currency: order.currency,
  quantity: order.quantity,
  deliveredCodes: order.status === "paid" ? (order.deliveredCodes?.length ? order.deliveredCodes : order.deliveredCode ? [order.deliveredCode] : []) : [],
  supplierDeliveryPending: Boolean(order.supplierDeliveryPending),
  supplierError: order.supplierError || "",
});

// Create: same rules, prices, stock reservation and supplier flow as the website checkout
router.post("/orders", (req, res, next) => {
  const user = telegramUser(req.body);
  if (!user) return res.status(400).json({ error: "telegramId is required." });
  req.user = user;
  return createOrder(req, res, next);
});

router.post("/orders/:id/started", async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ error: "Invalid order id." });
    const holdMinutes = Math.min(180, Math.max(0, Number(req.body?.holdMinutes) || 0));
    await Order.updateOne(
      { _id: req.params.id, status: "pending", userId: /^telegram:/ },
      { $set: { paymentStartedAt: new Date(), ...(holdMinutes ? { paymentHoldUntil: new Date(Date.now() + holdMinutes * 60 * 1000) } : {}) } },
    );
    res.json({ ok: true });
  } catch (error) { next(error); }
});

router.post("/orders/:id/paid", async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ error: "Invalid order id." });
    const method = ["zinipay", "cryptomus"].includes(req.body?.method) ? req.body.method : "";
    const reference = String(req.body?.reference || "").slice(0, 200);
    if (!method || !reference) return res.status(400).json({ error: "method and reference are required." });
    const order = await Order.findOne({ _id: req.params.id, userId: /^telegram:/ });
    if (!order) return res.status(404).json({ error: "Order not found." });
    let fulfilError = "";
    if (order.status !== "paid") {
      try { await fulfillPaidOrder(String(order._id), { method, reference }); }
      catch (error) { fulfilError = error.message; console.error(`Bot order ${order._id} fulfilment:`, error.message); }
    }
    const fresh = await Order.findById(order._id);
    res.json({ order: view(fresh), error: fulfilError });
  } catch (error) { next(error); }
});

// Only orders the bot created can be cancelled here
router.post("/orders/:id/cancel", async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ error: "Invalid order id." });
    if (!(await Order.exists({ _id: req.params.id, userId: /^telegram:/ }))) return res.status(404).json({ error: "Order not found." });
    req.user = { id: "telegram-bot", email: "telegram-bot" };
    return cancelOrder(req, res, next);
  } catch (error) { next(error); }
});

router.get("/orders/:id", async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ error: "Invalid order id." });
    const order = await Order.findOne({ _id: req.params.id, userId: /^telegram:/ });
    if (!order) return res.status(404).json({ error: "Order not found." });
    res.json({ order: view(order) });
  } catch (error) { next(error); }
});

export default router;
