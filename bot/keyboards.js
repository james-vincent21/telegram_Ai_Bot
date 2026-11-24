const { Markup } = require("telegraf");
const strings = require("./config/strings");
const { shortId } = require("../services/ipdokan");

/**
 * Button colors (Bot API 9.4+, `style` field). Telegram apps released before
 * Feb 2026 ignore it and show the normal button, so it is always safe to send.
 *   primary = blue  (main / navigation actions)
 *   success = green (buy, pay, confirm, increase)
 *   danger  = red   (cancel, remove, decrease, sold out)
 */
const BLUE = "primary";
const GREEN = "success";
const RED = "danger";

/** Adds a color to any inline or reply keyboard button. */
function paint(button, style) {
  return style ? { ...button, style } : button;
}

const cb = (text, data, style) => paint(Markup.button.callback(text, data), style);
const url = (text, link, style) => paint(Markup.button.url(text, link), style);
const key = (text, style) => paint({ text }, style);

/**
 * Standard navigation row on every screen:
 *   🟡 ‹ Back (yellow marker) · 🏠 Home (green) · ✖️ Exit (red)
 * @param {string} [backAction] - callback for Back; omit to hide it
 */
function navRow(backAction) {
  const row = [];
  // Telegram has no yellow button color, so "yellow" = 🟡 marker on a plain button
  if (backAction) row.push(cb("🟡 ‹ Back", backAction));
  row.push(cb("🏠 Home", "go_home", GREEN));
  row.push(cb("✖️ Exit", "nav_exit", RED));
  return row;
}

/** Mini App URL, only when it's https (Telegram refuses anything else) */
function shopUrl() {
  const u = (process.env.SHOP_URL || "").trim();
  return /^https:\/\//i.test(u) ? u : null;
}

/** "🛍 Open Shop" Mini App button, or null when no https SHOP_URL is set */
function shopButton(style = BLUE) {
  const u = shopUrl();
  return u ? paint(Markup.button.webApp(strings.shopButton, u), style) : null;
}

function chunk(list, size) {
  const rows = [];
  for (let i = 0; i < list.length; i += size) rows.push(list.slice(i, i + size));
  return rows;
}

/** Main persistent reply keyboard */
function mainMenuKeyboard() {
  return Markup.keyboard([
    [key(strings.buyProxyButton, GREEN)],
    [key(strings.myOrdersButton, BLUE), key(strings.supportButton)],
  ])
    .resize()
    .persistent()
    .placeholder("Pick an option below 👇");
}

/** Quick actions shown under the welcome message */
function welcomeKeyboard() {
  const shop = shopButton();
  return Markup.inlineKeyboard([
    [cb("⚡ Start Shopping", "new_buy", GREEN)],
    ...(shop ? [[shop]] : []),
    [cb("🧾 My Orders", "open_orders", BLUE), cb("💬 Support", "open_support")],
    [cb("✖️ Exit", "nav_exit", RED)],
  ]);
}

/**
 * Category picker
 * @param {Array} categories - { id, name, count, emoji }
 */
function categoriesKeyboard(categories) {
  const buttons = categories.map((cat) =>
    cb(`${cat.emoji} ${cat.name} · ${cat.count}`, `cat_${cat.id}`, BLUE),
  );
  const rows = chunk(buttons, 2);
  rows.push([cb("🔄 Refresh Categories", "refresh_categories")]);
  rows.push(navRow("go_home"));
  return Markup.inlineKeyboard(rows);
}

/** Products inside a category */
function productsKeyboard(products, categoryId) {
  const buttons = products.map((prod) =>
    cb(`✦ ${prod.name}`, `prod_${prod.id}_${categoryId}`, BLUE),
  );
  const rows = chunk(buttons, 2);
  rows.push([cb("🔄 Refresh Products", `cat_${categoryId}`)]);
  rows.push(navRow("back_to_cats"));
  return Markup.inlineKeyboard(rows);
}

const LOW_STOCK = 10;

/**
 * Packages / variations, colored by stock:
 *   10 or more (or unlimited) → 🟢 green
 *   1–9 left                  → 🟡 yellow marker (Telegram has no yellow button)
 *   0 / sold out              → 🔴 red
 */
function variationsKeyboard(variations, productId, categoryId) {
  const rows = variations.map((v) => {
    const qty = v.stockQuantity;
    const soldOut = !v.inStock || qty === 0;
    const vid = shortId(v.id);
    if (soldOut) {
      return [cb(`🔴 ${v.name}  ·  Sold out`, `outofstock_${vid}`, RED)];
    }
    const data = `var_${productId}_${vid}_${categoryId}`;
    const pin = v.chooseLocation ? " 📍" : "";
    if (qty != null && qty < LOW_STOCK) {
      return [cb(`🟡 ${v.name}${pin}  ·  ${v.price} ৳ · only ${qty} left`, data)];
    }
    const badge = qty != null ? ` · ${qty} left` : "";
    return [cb(`🟢 ${v.name}${pin}  ·  ${v.price} ৳${badge}`, data, GREEN)];
  });
  rows.push(navRow(`cat_${categoryId}`));
  return Markup.inlineKeyboard(rows);
}

/**
 * Location picker for packages that need one (static residential, ISP…).
 * Callback data: loc_<productId>_<variationShortId>_<locationId>_<categoryId>
 */
function locationsKeyboard(locations, productId, variationId, categoryId = 0) {
  const vid = shortId(variationId);
  const cid = categoryId || 0;
  const rows = locations.map((l) => {
    if (!l.inStock) return [cb(`🔴 ${l.name} · Sold out`, "outofstock_0", RED)];
    const badge = l.stock != null ? ` · ${l.stock}` : "";
    return [cb(`📍 ${l.name}${badge}`, `loc_${productId}_${vid}_${l.id}_${cid}`, BLUE)];
  });
  rows.push(navRow(cid ? `prod_${productId}_${cid}` : "back_to_cats"));
  return Markup.inlineKeyboard(rows);
}

/**
 * Quantity selector.
 * Callback data: qty_<productId>_<variationId>_<qty>_<categoryId>_<locationId>
 *                buy_<productId>_<variationId>_<qty>_<categoryId>_<locationId>
 * variationId 0 = simple product, locationId 0 = no location.
 * categoryId 0 = unknown (old buttons), Back then goes to the category list.
 */
function quantityKeyboard(productId, variationId, quantity, max, totalLabel, categoryId = 0, locationId = 0) {
  const vid = variationId ? shortId(variationId) : 0;
  const cid = categoryId || 0;
  const lid = locationId || 0;
  const set = (q) => `qty_${productId}_${vid}_${Math.min(max, Math.max(1, q))}_${cid}_${lid}`;
  // Back: locations → packages list (variable product) → products list (simple product) → categories
  const back = !cid
    ? "back_to_cats"
    : lid
      ? `var_${productId}_${vid}_${cid}`
      : vid
        ? `prod_${productId}_${cid}`
        : `cat_${cid}`;

  const presets = [1, 5, 10, 25, 50].filter((q) => q <= max);
  return Markup.inlineKeyboard([
    [
      cb("➖", set(quantity - 1), quantity > 1 ? RED : undefined),
      cb(`🔢 ${quantity}`, set(quantity)),
      cb("➕", set(quantity + 1), quantity < max ? GREEN : undefined),
    ],
    presets.map((q) => cb(q === quantity ? `✅ ${q}` : `×${q}`, set(q), q === quantity ? BLUE : undefined)),
    [cb(`🛒 Confirm Order · ${totalLabel}`, `buy_${productId}_${vid}_${quantity}_${cid}_${lid}`, GREEN)],
    navRow(back),
  ]);
}

/**
 * Payment method picker for a new order.
 * @param {{orderId, amount, amountUsd}} order
 * @param {Array<{id: string, label: string, currency: string}>} methods
 */
function paymentMethodsKeyboard(order, methods) {
  const rows = methods
    .filter((m) => (m.currency === "USD" ? order.amountUsd > 0 : order.amount > 0))
    .map((m) => [
      cb(
        `${m.label} · ${m.currency === "USD" ? `$${order.amountUsd}` : `${order.amount} ৳`}`,
        `pay_${m.id}_${order.orderId}`,
        GREEN,
      ),
    ]);
  rows.push([cb(strings.cancelButtonText, `cancel_order_${order.orderId}`, RED)]);
  rows.push([cb("🏠 Home", "go_home", GREEN)]);
  return Markup.inlineKeyboard(rows);
}

/** Checkout: pay (green) / cancel (red) */
function orderPaymentKeyboard(checkoutUrl, orderId, amount, currency) {
  return Markup.inlineKeyboard([
    [url(strings.payButtonText(amount, currency), checkoutUrl, GREEN)],
    [cb(strings.cancelButtonText, `cancel_order_${orderId}`, RED)],
    [cb("🏠 Home", "go_home", GREEN)],
  ]);
}

/**
 * Order history. Only unpaid orders can be removed.
 * @param {number} pendingCount
 * @param {Array} [toolOrders] - recent delivered orders that get Test / Memo buttons
 */
function userOrdersKeyboard(pendingCount = 0, toolOrders = []) {
  const rows = [];
  for (const o of toolOrders) {
    const short = o.orderId.slice(-4);
    rows.push([
      cb(`✅ Test #${short}`, `check_${o.orderId}`, GREEN),
      cb(`🧾 Memo #${short}`, `memo_${o.orderId}`),
    ]);
  }
  if (pendingCount > 0) {
    rows.push([cb(`🗑 Clear Unpaid Orders · ${pendingCount}`, "user_clear_pending", RED)]);
  }
  rows.push([
    cb("🔄 Refresh", "user_refresh_orders"),
    cb("⚡ Buy Proxy", "back_to_cats", GREEN),
  ]);
  rows.push(navRow());
  return Markup.inlineKeyboard(rows);
}

/**
 * Under delivery / payment messages. These open NEW messages so the
 * credentials message is never overwritten.
 */
function afterDeliveryKeyboard(orderId) {
  const rows = [];
  if (orderId) {
    rows.push([cb("✅ Check Proxy", `check_${orderId}`, GREEN), cb("🧾 Get Memo", `memo_${orderId}`)]);
  }
  rows.push([cb("⚡ Buy Again", "new_buy", GREEN), cb("🧾 My Orders", "open_orders", BLUE)]);
  rows.push([cb("🎫 Need help?", "ticket_new")]);
  return Markup.inlineKeyboard(rows);
}

/** Under proxy-check results */
function proxyCheckKeyboard(orderId, allOk) {
  const rows = [[cb("🔄 Test Again", `check_${orderId}`, BLUE)]];
  if (!allOk) rows.push([cb("🎫 Open a Ticket", "ticket_new", GREEN)]);
  rows.push([cb("✖️ Close", "nav_exit", RED)]);
  return Markup.inlineKeyboard(rows);
}

/** Under expiry reminders */
function expiryReminderKeyboard(orderId) {
  return Markup.inlineKeyboard([
    [cb("🔄 Renew Now", `renew_${orderId}`, GREEN)],
    [cb("✅ Check Proxy", `check_${orderId}`, BLUE), cb("🎫 Help", "ticket_new")],
  ]);
}

// ---------- Support tickets ----------
function ticketInputKeyboard() {
  return Markup.inlineKeyboard([[cb("✖️ Cancel", "ticket_cancel_input", RED)]]);
}

function ticketCreatedKeyboard() {
  return Markup.inlineKeyboard([
    [cb("📂 My Tickets", "tickets_list", BLUE)],
    navRow(),
  ]);
}

function ticketsListKeyboard(tickets) {
  const icon = { open: "🟡", answered: "🟢", closed: "⚫️" };
  const rows = tickets.map((t) => [
    cb(`${icon[t.status] || "⚪️"} ${t.ticketNo} · ${t.messages.length} msg`, `ticket_view_${t._id}`, t.status === "answered" ? GREEN : undefined),
  ]);
  rows.push([cb("🎫 New Ticket", "ticket_new", GREEN)]);
  rows.push(navRow("open_support_edit"));
  return Markup.inlineKeyboard(rows);
}

function ticketViewKeyboard(ticket) {
  const rows = [];
  if (ticket.status !== "closed") {
    rows.push([
      cb("💬 Reply", `ticket_reply_${ticket._id}`, GREEN),
      cb("✅ Close Ticket", `ticket_close_${ticket._id}`, RED),
    ]);
  } else {
    rows.push([cb("🎫 New Ticket", "ticket_new", GREEN)]);
  }
  rows.push(navRow("tickets_list"));
  return Markup.inlineKeyboard(rows);
}

/** Sent with an admin reply (from the admin panel) */
function ticketReplyKeyboard(ticketId) {
  return Markup.inlineKeyboard([
    [cb("💬 Reply", `ticket_reply_${ticketId}`, GREEN), cb("📂 View Ticket", `ticket_view_${ticketId}`, BLUE)],
    [cb("✅ Close Ticket", `ticket_close_${ticketId}`, RED)],
  ]);
}

/** Shown when something failed to load */
function retryKeyboard(action) {
  return Markup.inlineKeyboard([
    [cb("🔄 Try Again", action, BLUE)],
    navRow(),
  ]);
}

/** Just the navigation row (e.g. under "sold out" / "not found" messages) */
function navKeyboard(backAction) {
  return Markup.inlineKeyboard([navRow(backAction)]);
}

/** Support message actions */
function supportKeyboard(contact, website = "https://ipdokan.com") {
  const handle = String(contact || "").replace(/^@/, "");
  const rows = [[cb("🎫 New Ticket", "ticket_new", GREEN), cb("📂 My Tickets", "tickets_list", BLUE)]];
  const live = [];
  if (/^[A-Za-z0-9_]{4,}$/.test(handle)) live.push(url("💬 Chat", `https://t.me/${handle}`));
  live.push(url("🌐 Website", website));
  rows.push(live);
  rows.push(navRow());
  return Markup.inlineKeyboard(rows);
}

module.exports = {
  mainMenuKeyboard,
  welcomeKeyboard,
  categoriesKeyboard,
  productsKeyboard,
  variationsKeyboard,
  locationsKeyboard,
  quantityKeyboard,
  orderPaymentKeyboard,
  paymentMethodsKeyboard,
  userOrdersKeyboard,
  afterDeliveryKeyboard,
  retryKeyboard,
  supportKeyboard,
  navKeyboard,
  shopButton,
  shopUrl,
  proxyCheckKeyboard,
  expiryReminderKeyboard,
  ticketInputKeyboard,
  ticketCreatedKeyboard,
  ticketsListKeyboard,
  ticketViewKeyboard,
  ticketReplyKeyboard,
};
