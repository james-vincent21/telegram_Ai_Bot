require("dotenv").config();
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");

const Admin = require("../models/Admin");
const catalog = require("../services/ipdokan");

async function seed() {
  const mongoUri =
    process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/telegram_proxy_store";
  console.log(`Connecting to MongoDB...`);
  await mongoose.connect(mongoUri);

  console.log("🌱 Starting database seed...");

  // 1. Seed or update Admin user
  const adminUsername = process.env.ADMIN_PANEL_USERNAME || "admin";
  const plainPassword = process.env.ADMIN_PANEL_PASSWORD || "admin123";
  const hashedPassword = await bcrypt.hash(plainPassword, 10);

  await Admin.findOneAndUpdate(
    { username: adminUsername },
    { $set: { password: hashedPassword, role: "superadmin" } },
    { upsert: true, new: true },
  );
  console.log(`👤 Admin user verified/created: "${adminUsername}"`);

  // 2. Mirror ipdokan.com products into Brands / Plans.
  //    (No sample stock: real credentials are uploaded in the admin panel.)
  console.log("🔄 Syncing products from ipdokan.com...");
  try {
    const { brands, plans } = await catalog.syncToStore();
    console.log(`📦 Synced ${brands} products and ${plans} packages.`);
  } catch (err) {
    console.error("⚠️ ipdokan.com sync warning:", err.message);
  }

  console.log("\n✅ Database seeding complete!");
  process.exit(0);
}

seed().catch((err) => {
  console.error("❌ Seeding failed:", err);
  process.exit(1);
});
