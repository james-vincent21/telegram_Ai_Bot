/**
 * Animated checkout progress for Telegram messages.
 *
 * Telegram can't animate text, so the "pulse" is made by editing the message
 * a few times (about once a second): the current step blinks 🟢 ⇄ ⚪️.
 *   🟢 = finished step / current step     🔴 = steps still to go
 *
 * Strings mark where the progress goes with a token such as %%STEPS:2%%.
 * Any button tap on the message stops its animation straight away, so a
 * late animation frame can never overwrite the next screen.
 *
 * Turn it off with STEP_ANIMATION=off in .env.
 */

const LABELS = ["Category", "Product", "Package", "Quantity", "Payment"];
const TOKEN = /%%STEPS:(\d)%%/;
const FRAME_MS = 1000; // Telegram allows about 1 edit per second per chat
const BLINKS = 3; // how many times the current step blinks

const running = new Map(); // "chatId:messageId" -> token of the running animation

function stepToken(step) {
  return `%%STEPS:${step}%%`;
}

function track(current, blink) {
  const dots = LABELS.map((_, i) => {
    const n = i + 1;
    if (n < current) return "🟢";
    if (n === current) return blink ? "⚪️" : "🟢";
    return "🔴";
  });
  return `${dots.join(" ━ ")}\n📍 <b>Step ${current} of ${LABELS.length}</b> · ${LABELS[current - 1]}`;
}

/** Replace the step token with the progress bar (blink = current step dimmed). */
function render(text, blink = false) {
  const m = text.match(TOKEN);
  return m ? text.replace(TOKEN, track(parseInt(m[1], 10), blink)) : text;
}

function keyOf(chatId, messageId) {
  return `${chatId}:${messageId}`;
}

function cancel(chatId, messageId) {
  running.delete(keyOf(chatId, messageId));
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function pulse(telegram, chatId, messageId, text, extra) {
  if (!TOKEN.test(text) || String(process.env.STEP_ANIMATION).toLowerCase() === "off") return;

  const key = keyOf(chatId, messageId);
  const token = Symbol(key);
  running.set(key, token);

  (async () => {
    for (let i = 0; i < BLINKS * 2; i++) {
      await sleep(FRAME_MS);
      if (running.get(key) !== token) return; // user moved on
      try {
        // Ends on an even frame, so the last state is the normal 🟢 one
        await telegram.editMessageText(chatId, messageId, undefined, render(text, i % 2 === 0), {
          parse_mode: "HTML",
          ...extra,
        });
      } catch (err) {
        if (!/message is not modified/i.test(err.message)) break; // deleted, rate-limited, etc.
      }
    }
    if (running.get(key) === token) running.delete(key);
  })().catch(() => running.delete(key));
}

/** Send a new screen and start its animation. */
async function reply(ctx, text, extra = {}) {
  const msg = await ctx.reply(render(text), { parse_mode: "HTML", ...extra });
  pulse(ctx.telegram, msg.chat.id, msg.message_id, text, extra);
  return msg;
}

/** Replace the current screen (callback message) and start its animation. */
async function edit(ctx, text, extra = {}) {
  const msg = ctx.callbackQuery?.message;
  if (msg) cancel(msg.chat.id, msg.message_id);
  const result = await ctx.editMessageText(render(text), { parse_mode: "HTML", ...extra });
  if (msg) pulse(ctx.telegram, msg.chat.id, msg.message_id, text, extra);
  return result;
}

/** Middleware: any tap on a message stops that message's animation. */
function stopOnTap(ctx, next) {
  const msg = ctx.callbackQuery?.message;
  if (msg) cancel(msg.chat.id, msg.message_id);
  return next();
}

module.exports = { stepToken, render, reply, edit, cancel, stopOnTap };
