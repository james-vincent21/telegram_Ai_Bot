const { Markup } = require("telegraf");
const strings = require("./config/strings");

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
 *   ‹ Back (blue) · 🏠 Home (green) · ✖️ Exit (red)
 * @param {string} [backAction] - callback for Back; omit to hide it
 */
function navRow(backAction) {
  const row = [];
  if (backAction) row.push(cb("‹ Back", backAction, BLUE));
  row.push(cb("🏠 Home", "go_home", GREEN));
  row.push(cb("✖️ Exit", "nav_exit", RED));
  return row;
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
  return Markup.inlineKeyboard([
    [cb("⚡ Start Shopping", "new_buy", GREEN)],
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

/** Packages / variations: green = available, red = sold out */
function variationsKeyboard(variations, productId, categoryId) {
  const rows = variations.map((v) => {
    if (v.inStock) {
      const stockBadge = v.stockQuantity ? ` · ${v.stockQuantity} left` : "";
      return [cb(`⚡ ${v.name}  ·  ${v.price} ৳${stockBadge}`, `var_${productId}_${v.id}_${categoryId}`, GREEN)];
    }
    return [cb(`🚫 ${v.name}  ·  Sold out`, `outofstock_${v.id}`, RED)];
  });
  rows.push(navRow(`cat_${categoryId}`));
  return Markup.inlineKeyboard(rows);
}

/**
 * Quantity selector.
 * Callback data: qty_<productId>_<variationId>_<qty>_<categoryId> (variationId 0 = simple product)
 *                buy_<productId>_<variationId>_<qty>_<categoryId>
 * categoryId 0 = unknown (old buttons), Back then goes to the category list.
 */
function quantityKeyboard(productId, variationId, quantity, max, totalLabel, categoryId = 0) {
  const vid = variationId || 0;
  const cid = categoryId || 0;
  const set = (q) => `qty_${productId}_${vid}_${Math.min(max, Math.max(1, q))}_${cid}`;
  // Back: packages list (variable product) → products list (simple product) → categories
  const back = !cid ? "back_to_cats" : vid ? `prod_${productId}_${cid}` : `cat_${cid}`;

  const presets = [1, 5, 10, 25, 50].filter((q) => q <= max);
  return Markup.inlineKeyboard([
    [
      cb("➖", set(quantity - 1), quantity > 1 ? RED : undefined),
      cb(`🔢 ${quantity}`, set(quantity)),
      cb("➕", set(quantity + 1), quantity < max ? GREEN : undefined),
    ],
    presets.map((q) => cb(q === quantity ? `✅ ${q}` : `×${q}`, set(q), q === quantity ? BLUE : undefined)),
    [cb(`🛒 Confirm Order · ${totalLabel}`, `buy_${productId}_${vid}_${quantity}_${cid}`, GREEN)],
    navRow(back),
  ]);
}

/** Checkout: pay (green) / cancel (red) */
function orderPaymentKeyboard(checkoutUrl, orderId, amount, currency) {
  return Markup.inlineKeyboard([
    [url(strings.payButtonText(amount, currency), checkoutUrl, GREEN)],
    [cb(strings.cancelButtonText, `cancel_order_${orderId}`, RED)],
    [cb("🏠 Home", "go_home", GREEN)],
  ]);
}

/** Order history. Only unpaid orders can be removed. */
function userOrdersKeyboard(pendingCount = 0) {
  const rows = [];
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
function afterDeliveryKeyboard() {
  return Markup.inlineKeyboard([
    [cb("⚡ Buy Again", "new_buy", GREEN), cb("🧾 My Orders", "open_orders", BLUE)],
    [cb("💬 Need help?", "open_support")],
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
  const rows = [];
  if (/^[A-Za-z0-9_]{4,}$/.test(handle)) {
    rows.push([url("💬 Chat with Support", `https://t.me/${handle}`, GREEN)]);
  }
  rows.push([url("🌐 Visit Website", website, BLUE)]);
  rows.push(navRow());
  return Markup.inlineKeyboard(rows);
}

module.exports = {
  mainMenuKeyboard,
  welcomeKeyboard,
  categoriesKeyboard,
  productsKeyboard,
  variationsKeyboard,
  quantityKeyboard,
  orderPaymentKeyboard,
  userOrdersKeyboard,
  afterDeliveryKeyboard,
  retryKeyboard,
  supportKeyboard,
  navKeyboard,
};
