/**
 * Expiry reminders: messages customers a few days before their proxy expires,
 * with a "Renew Now" button. Runs inside the bot process.
 *
 * .env:
 *   REMINDER_DAYS_BEFORE=3   how many days before expiry to remind
 *   DEFAULT_PROXY_DAYS=30    duration used when the package name has none
 */
const Order = require("../models/Order");
const User = require("../models/User");
const strings = require("./config/strings");
const keyboards = require("./keyboards");

const CHECK_EVERY_MS = 60 * 60 * 1000; // hourly

async function sendDueReminders(telegram) {
  const daysBefore = parseInt(process.env.REMINDER_DAYS_BEFORE || "3", 10);
  const now = new Date();
  const until = new Date(now.getTime() + daysBefore * 24 * 60 * 60 * 1000);

  const due = await Order.find({
    status: "delivered",
    expiresAt: { $gt: now, $lte: until },
    expiryReminderSentAt: null,
  }).limit(200);

  let sent = 0;
  for (const order of due) {
    // Claim first so two processes never send the same reminder
    const claimed = await Order.findOneAndUpdate(
      { _id: order._id, expiryReminderSentAt: null },
      { $set: { expiryReminderSentAt: new Date() } },
    );
    if (!claimed) continue;

    const daysLeft = Math.ceil((order.expiresAt - now) / (24 * 60 * 60 * 1000));
    try {
      await telegram.sendMessage(order.telegramId, strings.expiryReminder(order, daysLeft), {
        parse_mode: "HTML",
        ...keyboards.expiryReminderKeyboard(order.orderId),
      });
      sent++;
    } catch (err) {
      if (err.response?.error_code === 403) {
        await User.updateOne({ telegramId: order.telegramId }, { $set: { isBlocked: true } }).catch(() => {});
      } else {
        console.error(`[Reminders] ${order.orderId}:`, err.message);
      }
    }
    await new Promise((r) => setTimeout(r, 60)); // stay well under Telegram limits
  }
  if (sent) console.log(`⏰ [Reminders] Sent ${sent} expiry reminder(s)`);
}

function startReminderScheduler(telegram) {
  const run = () => sendDueReminders(telegram).catch((err) => console.error("[Reminders]", err.message));
  setTimeout(run, 30 * 1000); // shortly after start
  return setInterval(run, CHECK_EVERY_MS);
}

module.exports = { startReminderScheduler, sendDueReminders };
