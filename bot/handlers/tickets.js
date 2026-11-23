/**
 * Support tickets inside the bot. Admins answer from the admin panel
 * (server/routes/api.js → /tickets/:id/reply), which messages the customer.
 */
const Ticket = require("../../models/Ticket");
const strings = require("../config/strings");
const keyboards = require("../keyboards");
const notifyAdminService = require("../../services/notifyAdmin");

const INPUT_TTL_MS = 15 * 60 * 1000;
// telegramId -> { mode: "new" | "reply", ticketId?, until }
const waitingForText = new Map();

function startInput(telegramId, mode, ticketId) {
  waitingForText.set(telegramId, { mode, ticketId, until: Date.now() + INPUT_TTL_MS });
}

function takeInput(telegramId) {
  const s = waitingForText.get(telegramId);
  if (!s) return null;
  if (s.until < Date.now()) {
    waitingForText.delete(telegramId);
    return null;
  }
  return s;
}

function adminAlert(ticket, text, isNew) {
  const who = ticket.telegramUsername ? `@${ticket.telegramUsername}` : strings.esc(ticket.telegramFirstName || "Customer");
  const base = (process.env.APP_BASE_URL || "").replace(/\/$/, "");
  return (
    `🎫 <b>${isNew ? "New ticket" : "New reply"} · ${ticket.ticketNo}</b>\n` +
    `👤 ${who} (<code>${ticket.telegramId}</code>)` +
    `${ticket.orderId ? `\n🆔 <code>${ticket.orderId}</code>` : ""}\n\n` +
    `<blockquote>${strings.esc(text.slice(0, 1500))}</blockquote>\n\n` +
    `↩️ Reply from the admin panel${base ? `: ${base}/admin/` : "."}`
  );
}

function registerTicketHandlers(bot) {
  // Start a new ticket
  bot.action("ticket_new", async (ctx) => {
    await ctx.answerCbQuery();
    startInput(ctx.from.id, "new");
    return ctx.reply(strings.ticketAsk, { parse_mode: "HTML", ...keyboards.ticketInputKeyboard() });
  });
  bot.command("ticket", async (ctx) => {
    startInput(ctx.from.id, "new");
    return ctx.reply(strings.ticketAsk, { parse_mode: "HTML", ...keyboards.ticketInputKeyboard() });
  });

  bot.action("ticket_cancel_input", async (ctx) => {
    waitingForText.delete(ctx.from.id);
    await ctx.answerCbQuery("Cancelled");
    return ctx.editMessageText(strings.ticketInputCancelled).catch(() => {});
  });

  // List my tickets
  async function ticketsView(telegramId) {
    const tickets = await Ticket.find({ telegramId }).sort({ lastMessageAt: -1 }).limit(8);
    if (!tickets.length) return { text: strings.ticketNone, extra: keyboards.ticketsListKeyboard([]) };
    return { text: strings.ticketsHeader, extra: keyboards.ticketsListKeyboard(tickets) };
  }

  bot.action("tickets_list", async (ctx) => {
    await ctx.answerCbQuery();
    const v = await ticketsView(ctx.from.id);
    return ctx
      .editMessageText(v.text, { parse_mode: "HTML", ...v.extra })
      .catch(() => ctx.reply(v.text, { parse_mode: "HTML", ...v.extra }));
  });
  bot.command("tickets", async (ctx) => {
    const v = await ticketsView(ctx.from.id);
    return ctx.reply(v.text, { parse_mode: "HTML", ...v.extra });
  });

  // View one ticket
  bot.action(/^ticket_view_([a-f0-9]{24})$/, async (ctx) => {
    const ticket = await Ticket.findOne({ _id: ctx.match[1], telegramId: ctx.from.id });
    if (!ticket) return ctx.answerCbQuery("Ticket not found.", { show_alert: true });
    await ctx.answerCbQuery();
    const text = strings.ticketView(ticket);
    const extra = { parse_mode: "HTML", ...keyboards.ticketViewKeyboard(ticket) };
    return ctx.editMessageText(text, extra).catch(() => ctx.reply(text, extra));
  });

  // Reply to a ticket
  bot.action(/^ticket_reply_([a-f0-9]{24})$/, async (ctx) => {
    const ticket = await Ticket.findOne({ _id: ctx.match[1], telegramId: ctx.from.id });
    if (!ticket) return ctx.answerCbQuery("Ticket not found.", { show_alert: true });
    if (ticket.status === "closed") return ctx.answerCbQuery("This ticket is closed. Please open a new one.", { show_alert: true });
    await ctx.answerCbQuery();
    startInput(ctx.from.id, "reply", String(ticket._id));
    return ctx.reply(strings.ticketReplyAsk(ticket.ticketNo), { parse_mode: "HTML", ...keyboards.ticketInputKeyboard() });
  });

  // Close a ticket
  bot.action(/^ticket_close_([a-f0-9]{24})$/, async (ctx) => {
    const ticket = await Ticket.findOneAndUpdate(
      { _id: ctx.match[1], telegramId: ctx.from.id },
      { $set: { status: "closed" } },
      { new: true },
    );
    if (!ticket) return ctx.answerCbQuery("Ticket not found.", { show_alert: true });
    await ctx.answerCbQuery("Ticket closed");
    return ctx
      .editMessageText(strings.ticketClosedByUser(ticket.ticketNo), { parse_mode: "HTML", ...keyboards.ticketCreatedKeyboard() })
      .catch(() => {});
  });
}

/**
 * Catches the customer's typed message while a ticket is waiting for text.
 * Register after admin handlers and before the fallback reply.
 */
function registerTicketTextHandler(bot) {
  bot.on("text", async (ctx, next) => {
    const state = takeInput(ctx.from.id);
    const text = (ctx.message.text || "").trim();
    if (!state || text.startsWith("/")) return next();

    if (text.length < 5) return ctx.reply(strings.ticketTooShort);
    waitingForText.delete(ctx.from.id);

    if (state.mode === "reply" && state.ticketId) {
      const ticket = await Ticket.findOneAndUpdate(
        { _id: state.ticketId, telegramId: ctx.from.id },
        {
          $push: { messages: { from: "user", text: text.slice(0, 4000) } },
          $set: { status: "open", lastMessageAt: new Date() },
        },
        { new: true },
      );
      if (ticket) {
        await notifyAdminService.notifyAdmins(adminAlert(ticket, text, false));
        return ctx.reply(strings.ticketMessageAdded(ticket.ticketNo), { parse_mode: "HTML", ...keyboards.ticketCreatedKeyboard() });
      }
    }

    const orderMatch = text.match(/ORD-[A-Z0-9-]+/i);
    const ticket = await Ticket.create({
      ticketNo: await Ticket.newTicketNo(),
      telegramId: ctx.from.id,
      telegramUsername: ctx.from.username || "",
      telegramFirstName: ctx.from.first_name || "",
      orderId: orderMatch ? orderMatch[0].toUpperCase() : "",
      messages: [{ from: "user", text: text.slice(0, 4000) }],
    });
    await notifyAdminService.notifyAdmins(adminAlert(ticket, text, true));
    return ctx.reply(strings.ticketCreated(ticket.ticketNo), { parse_mode: "HTML", ...keyboards.ticketCreatedKeyboard() });
  });
}

module.exports = { registerTicketHandlers, registerTicketTextHandler };
