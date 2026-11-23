/**
 * Sends an admin message to all bot users (runs in the server process).
 * ~20 messages/second, waits when Telegram says "slow down" (429),
 * marks users who blocked the bot so later broadcasts skip them.
 */
const { Markup } = require("telegraf");
const Broadcast = require("../models/Broadcast");
const User = require("../models/User");
const keyboards = require("../bot/keyboards");

const DELAY_MS = 50;
const stopRequests = new Set();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function buildExtra(b) {
  const rows = [];
  if (b.buttonText && /^https?:\/\//i.test(b.buttonUrl || "")) {
    rows.push([Markup.button.url(b.buttonText.slice(0, 60), b.buttonUrl)]);
  }
  if (b.addShopButton) {
    const shop = keyboards.shopButton("success");
    rows.push([shop || { ...Markup.button.callback("⚡ Buy Proxy", "new_buy"), style: "success" }]);
  }
  return {
    parse_mode: "HTML",
    link_preview_options: { is_disabled: true },
    ...(rows.length ? Markup.inlineKeyboard(rows) : {}),
  };
}

function audienceFilter(audience) {
  const f = { isBlocked: { $ne: true } };
  if (audience === "buyers") f.totalOrders = { $gt: 0 };
  return f;
}

async function countAudience(audience) {
  return User.countDocuments(audienceFilter(audience));
}

async function sendOne(telegram, chatId, text, extra) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await telegram.sendMessage(chatId, text, extra);
      return "sent";
    } catch (err) {
      const code = err.response?.error_code;
      if (code === 429) {
        await sleep(((err.response?.parameters?.retry_after || 3) + 1) * 1000);
        continue;
      }
      if (code === 403 || /bot was blocked|user is deactivated|chat not found/i.test(err.message)) return "blocked";
      return "failed";
    }
  }
  return "failed";
}

/** Sends a test copy to the admins in ADMIN_IDS. Throws on bad HTML so the admin sees it. */
async function sendTest(telegram, data) {
  const ids = (process.env.ADMIN_IDS || "").split(",").map((s) => s.trim()).filter(Boolean);
  if (!ids.length) throw new Error("ADMIN_IDS is empty in .env, so there is nobody to send the test to.");
  const extra = buildExtra(data);
  for (const id of ids) await telegram.sendMessage(id, data.text, extra);
  return ids.length;
}

/** Starts sending in the background; returns immediately. */
function run(telegram, broadcast) {
  (async () => {
    const extra = buildExtra(broadcast);
    const cursor = User.find(audienceFilter(broadcast.audience)).select("telegramId").lean().cursor();
    let sent = 0, failed = 0, blocked = 0, n = 0;

    const save = (extraSet = {}) =>
      Broadcast.updateOne({ _id: broadcast._id }, { $set: { sent, failed, blocked, ...extraSet } }).catch(() => {});

    for await (const u of cursor) {
      if (stopRequests.has(String(broadcast._id))) {
        stopRequests.delete(String(broadcast._id));
        await save({ status: "stopped", finishedAt: new Date() });
        return;
      }
      const r = await sendOne(telegram, u.telegramId, broadcast.text, extra);
      if (r === "sent") sent++;
      else if (r === "blocked") {
        blocked++;
        await User.updateOne({ telegramId: u.telegramId }, { $set: { isBlocked: true } }).catch(() => {});
      } else failed++;
      if (++n % 25 === 0) await save();
      await sleep(DELAY_MS);
    }
    await save({ status: "done", finishedAt: new Date() });
    console.log(`📣 [Broadcast] ${broadcast._id} done: ${sent} sent, ${blocked} blocked, ${failed} failed`);
  })().catch(async (err) => {
    console.error("[Broadcast] crashed:", err.message);
    await Broadcast.updateOne({ _id: broadcast._id }, { $set: { status: "interrupted", finishedAt: new Date() } }).catch(() => {});
  });
}

async function start(telegram, data, adminName = "") {
  const running = await Broadcast.exists({ status: "sending" });
  if (running) throw new Error("Another broadcast is still sending. Wait for it to finish or stop it.");
  const total = await countAudience(data.audience);
  const b = await Broadcast.create({ ...data, total, createdBy: adminName, status: "sending" });
  run(telegram, b);
  return b;
}

function stop(id) {
  stopRequests.add(String(id));
}

/** On server start: anything left "sending" was cut off by a restart. */
async function markInterrupted() {
  await Broadcast.updateMany({ status: "sending" }, { $set: { status: "interrupted", finishedAt: new Date() } }).catch(() => {});
}

module.exports = { start, stop, sendTest, countAudience, markInterrupted };
