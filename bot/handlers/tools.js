/**
 * Order tools for customers: test a proxy, download the PDF memo.
 */
const Order = require("../../models/Order");
const strings = require("../config/strings");
const keyboards = require("../keyboards");
const { checkProxy, extractProxies } = require("../../services/proxyChecker");
const { sendReceipt, PAID_STATUSES } = require("../../services/receipt");

const CHECK_COOLDOWN_MS = 15 * 1000;
const lastCheck = new Map(); // telegramId -> timestamp

function registerToolHandlers(bot) {
  // ✅ Check Proxy: check_<orderId>
  bot.action(/^check_(.+)$/, async (ctx) => {
    const orderId = ctx.match[1];
    const now = Date.now();
    const wait = CHECK_COOLDOWN_MS - (now - (lastCheck.get(ctx.from.id) || 0));
    if (wait > 0) {
      return ctx.answerCbQuery(strings.proxyCheckWait(Math.ceil(wait / 1000)), { show_alert: true });
    }

    const order = await Order.findOne({ orderId, telegramId: ctx.from.id });
    if (!order || !order.deliveredCredentials) {
      return ctx.answerCbQuery("This order has no proxy to test yet.", { show_alert: true });
    }

    const all = extractProxies(order.deliveredCredentials, 1000);
    if (!all.length) {
      await ctx.answerCbQuery();
      return ctx.reply(strings.proxyNoAddress, { parse_mode: "HTML", ...keyboards.proxyCheckKeyboard(orderId, false) });
    }

    lastCheck.set(ctx.from.id, now);
    await ctx.answerCbQuery("🔎 Testing…");
    const msg = await ctx.reply(strings.proxyChecking(orderId), { parse_mode: "HTML" });

    const sample = all.slice(0, 3);
    const results = await Promise.all(sample.map((line) => checkProxy(line)));
    const allOk = results.every((r) => r.ok);
    return ctx.telegram
      .editMessageText(msg.chat.id, msg.message_id, undefined, strings.proxyCheckResult(orderId, results, all.length), {
        parse_mode: "HTML",
        ...keyboards.proxyCheckKeyboard(orderId, allOk),
      })
      .catch((err) => console.error("[ProxyCheck] edit failed:", err.message));
  });

  // 🧾 Memo: memo_<orderId> (re-sends the PDF on request)
  bot.action(/^memo_(.+)$/, async (ctx) => {
    const order = await Order.findOne({ orderId: ctx.match[1], telegramId: ctx.from.id });
    if (!order || !PAID_STATUSES.includes(order.status)) {
      return ctx.answerCbQuery("A memo is available after payment.", { show_alert: true });
    }
    await ctx.answerCbQuery("🧾 Preparing your memo…");
    ctx.sendChatAction("upload_document").catch(() => {});
    const ok = await sendReceipt(ctx.telegram, order, { force: true });
    if (!ok) await ctx.reply("😕 Couldn't create the memo right now. Please try again in a minute.");
  });
}

module.exports = { registerToolHandlers };
