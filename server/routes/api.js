const express = require("express");
const router = express.Router();
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");

const Brand = require("../../models/Brand");
const Plan = require("../../models/Plan");
const Stock = require("../../models/Stock");
const Order = require("../../models/Order");
const User = require("../../models/User");
const Admin = require("../../models/Admin");
const Ticket = require("../../models/Ticket");
const Broadcast = require("../../models/Broadcast");
const broadcastService = require("../../services/broadcast");
const stockService = require("../../services/stockService");
const catalog = require("../../services/ipdokan");
const strings = require("../../bot/config/strings");
const keyboards = require("../../bot/keyboards");
const { bot } = require("../../bot/index");
const { requireAdminAuth } = require("../middleware/auth");

const JWT_SECRET =
  process.env.JWT_SECRET || "default_super_secret_jwt_key_change_in_production";

// ==========================================
// 1. Authentication
// ==========================================
router.post("/auth/login", async (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res
      .status(400)
      .json({ error: "Username and password are required" });
  }

  try {
    let isValid = false;

    // First check database Admin collection
    const adminUser = await Admin.findOne({ username });
    if (adminUser) {
      isValid = await adminUser.comparePassword(password);
    } else {
      // Fallback to environment variables
      const envUser = process.env.ADMIN_PANEL_USERNAME || "admin";
      const envHash = process.env.ADMIN_PANEL_PASSWORD_HASH;
      const envPlainPassword = process.env.ADMIN_PANEL_PASSWORD || "admin123";

      if (username === envUser) {
        if (envHash) {
          isValid = await bcrypt.compare(password, envHash);
        } else {
          isValid = password === envPlainPassword;
        }
      }
    }

    if (!isValid) {
      return res
        .status(401)
        .json({ error: "Invalid admin username or password" });
    }

    const token = jwt.sign({ username, role: "admin" }, JWT_SECRET, {
      expiresIn: "7d",
    });

    return res.json({
      success: true,
      token,
      user: { username, role: "admin" },
    });
  } catch (err) {
    console.error("[AuthLogin] Error:", err);
    return res.status(500).json({ error: "Server authentication error" });
  }
});

// Protect all subsequent /api routes with JWT
router.use(requireAdminAuth);

// ==========================================
// 2. Dashboard Statistics
// ==========================================
router.get("/stats", async (req, res) => {
  try {
    const now = new Date();
    const startOfToday = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate(),
    );
    const startOfWeek = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    const [
      todayPaidOrders,
      weekPaidOrders,
      allPaidOrders,
      totalOrdersCount,
      pendingOrdersCount,
      totalCustomers,
      stockStats,
      recentOrders,
    ] = await Promise.all([
      Order.find({
        status: { $in: ["paid", "delivered", "processing", "completed"] },
        createdAt: { $gte: startOfToday },
      }),
      Order.find({
        status: { $in: ["paid", "delivered", "processing", "completed"] },
        createdAt: { $gte: startOfWeek },
      }),
      Order.find({
        status: { $in: ["paid", "delivered", "processing", "completed"] },
      }),
      Order.countDocuments(),
      Order.countDocuments({ status: "pending" }),
      User.countDocuments(),
      stockService.getStockSummary(5),
      Order.find().sort({ createdAt: -1 }).limit(5),
    ]);

    const todayRevenue = todayPaidOrders.reduce(
      (sum, o) => sum + (o.amount || 0),
      0,
    );
    const weekRevenue = weekPaidOrders.reduce(
      (sum, o) => sum + (o.amount || 0),
      0,
    );
    const totalRevenue = allPaidOrders.reduce(
      (sum, o) => sum + (o.amount || 0),
      0,
    );

    return res.json({
      revenue: {
        today: todayRevenue,
        week: weekRevenue,
        total: totalRevenue,
      },
      orders: {
        today: todayPaidOrders.length,
        week: weekPaidOrders.length,
        totalPaid: allPaidOrders.length,
        totalAll: totalOrdersCount,
        pending: pendingOrdersCount,
      },
      customers: totalCustomers,
      lowStockAlerts: stockStats.lowStockAlerts,
      recentOrders,
    });
  } catch (err) {
    console.error("[GetStats] Error:", err);
    return res.status(500).json({ error: err.message });
  }
});

// ==========================================
// 3. ipdokan.com catalog
// ==========================================
// Every product with its packages and locations, as the bot shows them
router.get("/ipdokan/products", async (req, res) => {
  try {
    const categories = await catalog.getCategories(req.query.refresh === "1");
    const result = [];
    for (const c of categories) {
      for (const p of await catalog.getProductsByCategory(c.id)) {
        const [product, packages] = await Promise.all([
          catalog.getProduct(p.id),
          catalog.getProductVariations(p.id),
        ]);
        result.push({ ...p, category: c.name, locations: product.locations, packages });
      }
    }
    return res.json(result);
  } catch (err) {
    return res.status(502).json({ error: `ipdokan.com: ${err.message}` });
  }
});

// Mirrors ipdokan.com products into Brands / Plans (so stock can be uploaded).
// "/woocommerce/sync" is kept for older admin panel builds.
router.post(["/ipdokan/sync", "/woocommerce/sync"], async (req, res) => {
  try {
    const { brands, plans } = await catalog.syncToStore();
    return res.json({
      success: true,
      message: `Synchronized ${brands} products and ${plans} packages from ipdokan.com!`,
    });
  } catch (err) {
    return res.status(502).json({ error: `ipdokan.com sync failed: ${err.message}` });
  }
});

// ==========================================
// 4. Brands CRUD
// ==========================================
router.get("/brands", async (req, res) => {
  try {
    const brands = await Brand.find().sort({ displayOrder: 1, name: 1 });
    return res.json(brands);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.post("/brands", async (req, res) => {
  try {
    const { name, emoji, description, isActive, displayOrder } = req.body;
    if (!name) return res.status(400).json({ error: "Brand name is required" });

    const brand = await Brand.create({
      name,
      emoji: emoji || "🌐",
      description: description || "",
      isActive: isActive !== false,
      displayOrder: Number(displayOrder) || 0,
    });
    return res.status(201).json(brand);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
});

router.put("/brands/:id", async (req, res) => {
  try {
    const updated = await Brand.findByIdAndUpdate(req.params.id, req.body, {
      new: true,
    });
    if (!updated) return res.status(404).json({ error: "Brand not found" });
    return res.json(updated);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
});

router.delete("/brands/:id", async (req, res) => {
  try {
    const brandId = req.params.id;
    const plansCount = await Plan.countDocuments({ brandId });
    if (plansCount > 0) {
      return res.status(400).json({
        error: `Cannot delete brand with ${plansCount} existing plans. Delete or reassign plans first.`,
      });
    }
    await Brand.findByIdAndDelete(brandId);
    return res.json({ success: true, message: "Brand deleted successfully" });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ==========================================
// 5. Plans CRUD
// ==========================================
router.get("/plans", async (req, res) => {
  try {
    const filter = {};
    if (req.query.brandId) filter.brandId = req.query.brandId;

    const plans = await Plan.find(filter)
      .populate("brandId", "name emoji")
      .sort({ brandId: 1, displayOrder: 1, price: 1 });
    return res.json(plans);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.post("/plans", async (req, res) => {
  try {
    const {
      brandId,
      label,
      price,
      currency,
      durationDays,
      isActive,
      displayOrder,
    } = req.body;
    if (!brandId || !label || price === undefined) {
      return res
        .status(400)
        .json({ error: "Brand, label, and price are required" });
    }

    const plan = await Plan.create({
      brandId,
      label,
      price: Number(price),
      currency: currency || "BDT",
      durationDays: Number(durationDays) || 30,
      isActive: isActive !== false,
      displayOrder: Number(displayOrder) || 0,
    });
    return res.status(201).json(plan);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
});

router.put("/plans/:id", async (req, res) => {
  try {
    const updated = await Plan.findByIdAndUpdate(req.params.id, req.body, {
      new: true,
    });
    if (!updated) return res.status(404).json({ error: "Plan not found" });
    return res.json(updated);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
});

router.delete("/plans/:id", async (req, res) => {
  try {
    await Plan.findByIdAndDelete(req.params.id);
    return res.json({ success: true, message: "Plan deleted successfully" });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ==========================================
// 6. Stock Management
// ==========================================
router.get("/stock/summary", async (req, res) => {
  try {
    const threshold = Number(req.query.threshold) || 5;
    const data = await stockService.getStockSummary(threshold);
    return res.json(data);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.get("/stock", async (req, res) => {
  try {
    const { brandId, planId, isUsed, page = 1, limit = 50 } = req.query;
    const filter = {};
    if (brandId) filter.brandId = brandId;
    if (planId) filter.planId = planId;
    if (isUsed !== undefined && isUsed !== "")
      filter.isUsed = isUsed === "true";

    const skip = (Number(page) - 1) * Number(limit);

    const [stockItems, totalCount] = await Promise.all([
      Stock.find(filter)
        .populate("brandId", "name")
        .populate("planId", "label")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(Number(limit)),
      Stock.countDocuments(filter),
    ]);

    return res.json({
      items: stockItems,
      total: totalCount,
      page: Number(page),
      totalPages: Math.ceil(totalCount / Number(limit)),
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.post("/stock/bulk", async (req, res) => {
  try {
    const {
      brandId,
      planId,
      wooProductId,
      wooVariationId,
      productName,
      variationName,
      locationId,
      locationName,
      credentials,
      batchNote,
    } = req.body;
    if (!credentials) {
      return res.status(400).json({ error: "Credentials are required" });
    }

    const result = await stockService.bulkAddStock(
      {
        brandId,
        planId,
        wooProductId,
        wooVariationId,
        productName,
        variationName,
        locationId,
        locationName,
      },
      credentials,
      batchNote,
    );
    return res.json(result);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
});

router.delete("/stock/:id", async (req, res) => {
  try {
    const item = await Stock.findById(req.params.id);
    if (!item) return res.status(404).json({ error: "Stock item not found" });
    if (item.isUsed) {
      return res
        .status(400)
        .json({
          error:
            "Cannot delete stock item that has already been delivered to a customer",
        });
    }
    await Stock.findByIdAndDelete(req.params.id);
    return res.json({ success: true, message: "Stock item removed" });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ==========================================
// 7. Orders Management
// ==========================================
router.get("/orders", async (req, res) => {
  try {
    const { status, search, page = 1, limit = 50 } = req.query;
    const filter = {};

    if (status && status !== "all") {
      filter.status = status;
    }

    if (search) {
      const searchNum = Number(search);
      const orConditions = [
        { orderId: { $regex: search, $options: "i" } },
        { wooOrderId: { $regex: search, $options: "i" } },
        { productName: { $regex: search, $options: "i" } },
        { telegramUsername: { $regex: search, $options: "i" } },
      ];
      if (!isNaN(searchNum)) {
        orConditions.push({ telegramId: searchNum });
      }
      filter.$or = orConditions;
    }

    const skip = (Number(page) - 1) * Number(limit);

    const [orders, totalCount] = await Promise.all([
      Order.find(filter)
        .populate("brandId", "name emoji")
        .populate("planId", "label price currency")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(Number(limit)),
      Order.countDocuments(filter),
    ]);

    return res.json({
      orders,
      total: totalCount,
      page: Number(page),
      totalPages: Math.ceil(totalCount / Number(limit)),
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// Manual Deliver Order by Admin
router.post("/orders/:id/deliver", async (req, res) => {
  const { credentials } = req.body;
  if (!credentials) {
    return res
      .status(400)
      .json({ error: "Credentials are required for manual delivery" });
  }

  try {
    const order = await Order.findById(req.params.id);
    if (!order) return res.status(404).json({ error: "Order not found" });

    order.status = "delivered";
    order.deliveredCredentials = credentials;
    order.deliveredAt = new Date();
    await order.save();

    // Send Telegram message to user
    try {
      const message = strings.deliverySuccess(
        order.productName || "Proxy",
        order.variationName || "",
        credentials,
        order.orderId,
      );
      await bot.telegram.sendMessage(order.telegramId, message, {
        parse_mode: "HTML",
        ...keyboards.afterDeliveryKeyboard(order.orderId),
      });
    } catch (tgErr) {
      console.error("Failed to send Telegram message:", tgErr.message);
    }

    return res.json({
      success: true,
      message: "Order delivered and customer notified.",
      order,
    });
  } catch (err) {
    console.error("[ManualDelivery] Error:", err.message);
    return res.status(500).json({ error: err.message });
  }
});

// Clear Orders (All or Filtered)
router.delete("/orders/clear", async (req, res) => {
  try {
    const { status } = req.query;
    const filter = {};
    if (status && status !== "all") {
      filter.status = status;
    }
    const result = await Order.deleteMany(filter);
    return res.json({
      success: true,
      deletedCount: result.deletedCount,
      message: `Cleared ${result.deletedCount} orders successfully.`,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ==========================================
// 8. Support Tickets
// ==========================================
router.get("/tickets", async (req, res) => {
  try {
    const { status = "all", search = "" } = req.query;
    const filter = {};
    if (status !== "all") filter.status = status;
    if (search) {
      const rx = { $regex: search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), $options: "i" };
      filter.$or = [{ ticketNo: rx }, { telegramUsername: rx }, { telegramFirstName: rx }, { orderId: rx }];
      if (!isNaN(Number(search))) filter.$or.push({ telegramId: Number(search) });
    }
    const [tickets, counts] = await Promise.all([
      Ticket.find(filter).sort({ lastMessageAt: -1 }).limit(100),
      Ticket.aggregate([{ $group: { _id: "$status", n: { $sum: 1 } } }]),
    ]);
    const byStatus = Object.fromEntries(counts.map((c) => [c._id, c.n]));
    return res.json({ tickets, counts: { open: byStatus.open || 0, answered: byStatus.answered || 0, closed: byStatus.closed || 0 } });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.get("/tickets/:id", async (req, res) => {
  try {
    const ticket = await Ticket.findById(req.params.id);
    if (!ticket) return res.status(404).json({ error: "Ticket not found" });
    return res.json(ticket);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.post("/tickets/:id/reply", async (req, res) => {
  const text = String(req.body.text || "").trim();
  if (!text) return res.status(400).json({ error: "Reply text is required" });
  try {
    const ticket = await Ticket.findByIdAndUpdate(
      req.params.id,
      {
        $push: { messages: { from: "admin", text: text.slice(0, 4000), adminName: req.admin?.username || "Admin" } },
        $set: { status: "answered", lastMessageAt: new Date() },
      },
      { new: true },
    );
    if (!ticket) return res.status(404).json({ error: "Ticket not found" });

    let delivered = true;
    try {
      await bot.telegram.sendMessage(ticket.telegramId, strings.ticketAdminReply(ticket.ticketNo, text), {
        parse_mode: "HTML",
        ...keyboards.ticketReplyKeyboard(String(ticket._id)),
      });
    } catch (tgErr) {
      delivered = false;
      console.error("[Tickets] Could not message customer:", tgErr.message);
    }
    return res.json({ ticket, delivered });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.post("/tickets/:id/status", async (req, res) => {
  const { status } = req.body;
  if (!["open", "answered", "closed"].includes(status)) return res.status(400).json({ error: "Invalid status" });
  try {
    const ticket = await Ticket.findByIdAndUpdate(req.params.id, { $set: { status } }, { new: true });
    if (!ticket) return res.status(404).json({ error: "Ticket not found" });
    if (status === "closed") {
      bot.telegram
        .sendMessage(ticket.telegramId, strings.ticketClosedByAdmin(ticket.ticketNo), { parse_mode: "HTML" })
        .catch(() => {});
    }
    return res.json(ticket);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ==========================================
// 9. Broadcast
// ==========================================
function broadcastInput(body) {
  return {
    text: String(body.text || "").trim().slice(0, 4000),
    buttonText: String(body.buttonText || "").trim().slice(0, 60),
    buttonUrl: String(body.buttonUrl || "").trim(),
    addShopButton: Boolean(body.addShopButton),
    audience: body.audience === "buyers" ? "buyers" : "all",
  };
}

router.get("/broadcasts", async (req, res) => {
  try {
    const [items, all, buyers] = await Promise.all([
      Broadcast.find().sort({ createdAt: -1 }).limit(20),
      broadcastService.countAudience("all"),
      broadcastService.countAudience("buyers"),
    ]);
    return res.json({ broadcasts: items, audience: { all, buyers }, shopEnabled: Boolean(keyboards.shopUrl()) });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.post("/broadcasts/test", async (req, res) => {
  const data = broadcastInput(req.body);
  if (!data.text) return res.status(400).json({ error: "Message text is required" });
  try {
    const n = await broadcastService.sendTest(bot.telegram, data);
    return res.json({ success: true, message: `Test sent to ${n} admin${n === 1 ? "" : "s"}.` });
  } catch (err) {
    const tgMsg = err.response?.description;
    return res.status(400).json({ error: tgMsg ? `Telegram rejected the message: ${tgMsg}` : err.message });
  }
});

router.post("/broadcasts", async (req, res) => {
  const data = broadcastInput(req.body);
  if (!data.text) return res.status(400).json({ error: "Message text is required" });
  try {
    const b = await broadcastService.start(bot.telegram, data, req.admin?.username || "");
    return res.json(b);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
});

router.post("/broadcasts/:id/stop", async (req, res) => {
  try {
    broadcastService.stop(req.params.id);
    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

module.exports = router;
