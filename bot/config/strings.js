/** Centralized user-facing strings for the IPDokan Telegram bot. */

const LINE = "━━━━━━━━━━━━━━━━━━━━";
const THIN = "┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈";

/**
 * Checkout progress placeholder. bot/stepAnimator.js turns it into the
 * animated 🟢 ━ 🟢 ━ ⚪️ ━ 🔴 ━ 🔴 bar.
 */
function steps(current) {
  return `%%STEPS:${current}%%`;
}

/** Makes user-typed text safe inside HTML messages */
function esc(text) {
  return String(text ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function fmtDate(d) {
  return new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

const TICKET_STATUS = {
  open: "🟡 Waiting for support",
  answered: "🟢 Support replied",
  closed: "⚫️ Closed",
};

module.exports = {
  esc,
  ticketStatus: (s) => TICKET_STATUS[s] || s,

  // ---------- Mini App shop ----------
  shopButton: "🛍 Open Shop",
  shopIntro:
    `🛍 <b>IPDokan Shop</b>\n\nBrowse every proxy with pictures, live stock and prices in our in-app shop.`,

  // ---------- Proxy check ----------
  proxyChecking: (orderId) =>
    `🔎 <b>Testing your proxy…</b>\n<code>${orderId}</code>\n\n<i>This takes up to 15 seconds.</i>`,
  proxyCheckResult: (orderId, results, total) => {
    const lines = results.map((r) =>
      r.ok
        ? `🟢 <code>${esc(r.label)}</code>\n     Working · ${r.protocol} · ${r.ms} ms\n     Exit IP: <code>${esc(r.ip)}</code>`
        : `🔴 <code>${esc(r.label)}</code>\n     Not working: ${esc(r.error)}`,
    );
    const okCount = results.filter((r) => r.ok).length;
    const head = okCount === results.length ? "✅ <b>Proxy is working</b>" : okCount ? "⚠️ <b>Some proxies failed</b>" : "❌ <b>Proxy is not working</b>";
    return (
      `${head}\n<code>${orderId}</code>\n${LINE}\n\n${lines.join("\n\n")}` +
      `${total > results.length ? `\n\n<i>Tested the first ${results.length} of ${total}.</i>` : ""}` +
      `${okCount < results.length ? `\n\n💬 Still not working? Open a ticket and we'll help.` : ""}`
    );
  },
  proxyNoAddress:
    `🤔 <b>Nothing to test</b>\n\nThese credentials don't contain a proxy address (like <code>host:port</code>). If you think it's wrong, open a support ticket.`,
  proxyCheckWait: (s) => `⏳ Please wait ${s}s before testing again.`,

  // ---------- Expiry reminder ----------
  expiryReminder: (order, daysLeft) =>
    `⏰ <b>Your proxy expires ${daysLeft <= 0 ? "today" : daysLeft === 1 ? "tomorrow" : `in ${daysLeft} days`}</b>\n${LINE}\n\n` +
    `<blockquote>📦 <b>${esc(order.productName || "Proxy")}</b> · ${esc(order.variationName || "Package")}\n` +
    `🆔 <code>${order.orderId}</code>\n` +
    `📅 Expires: <b>${fmtDate(order.expiresAt)}</b></blockquote>\n\n` +
    `🔄 Renew now so your work doesn't stop.`,

  // ---------- Support tickets ----------
  ticketAsk:
    `🎫 <b>New support ticket</b>\n${LINE}\n\n` +
    `✍️ Type your problem in <b>one message</b> and send it.\n` +
    `<i>Add your Order ID (like ORD-123456-7890) if it's about an order.</i>`,
  ticketReplyAsk: (no) => `💬 <b>Reply to ${no}</b>\n\n✍️ Type your message and send it.`,
  ticketCreated: (no) =>
    `✅ <b>Ticket ${no} created</b>\n\nOur team will reply right here in this chat. You'll get a notification.`,
  ticketMessageAdded: (no) => `✅ Message added to <b>${no}</b>. We'll reply soon.`,
  ticketTooShort: "✍️ Please write a bit more so we can understand the problem (at least 5 characters).",
  ticketInputCancelled: "👌 Cancelled. Nothing was sent.",
  ticketNone: `📭 <b>No tickets yet</b>\n\nTap <b>🎫 New Ticket</b> if you need help.`,
  ticketsHeader: `📂 <b>Your Support Tickets</b>\n${LINE}\n\nTap a ticket to see the conversation:`,
  ticketView: (t) => {
    const msgs = t.messages.slice(-6).map((m) =>
      m.from === "admin"
        ? `🛟 <b>Support</b> · <i>${fmtDate(m.at)}</i>\n<blockquote>${esc(m.text)}</blockquote>`
        : `👤 <b>You</b> · <i>${fmtDate(m.at)}</i>\n<blockquote>${esc(m.text)}</blockquote>`,
    );
    return (
      `🎫 <b>Ticket ${t.ticketNo}</b>\n${TICKET_STATUS[t.status] || t.status}\n${LINE}\n\n` +
      `${t.messages.length > 6 ? "<i>…earlier messages hidden</i>\n\n" : ""}${msgs.join("\n")}`
    );
  },
  ticketAdminReply: (no, text) =>
    `🛟 <b>Support replied</b> · ${no}\n${LINE}\n\n<blockquote>${esc(text)}</blockquote>\n\n<i>Tap Reply to answer.</i>`,
  ticketClosedByUser: (no) => `✅ <b>${no} closed.</b> Thanks! Open a new ticket anytime.`,
  ticketClosedByAdmin: (no) => `✅ <b>Ticket ${no} was closed by support.</b>\n\nNeed more help? Open a new ticket.`,

  // Reply-keyboard labels. LEGACY_* keep old keyboards (still shown on users' phones) working.
  mainMenuButton: "🏠 Home",
  buyProxyButton: "⚡ Buy Proxy",
  myOrdersButton: "🧾 My Orders",
  supportButton: "💬 Support",
  legacyButtons: {
    mainMenu: ["🏠 Main Menu"],
    buyProxy: ["🛒 Buy Proxy"],
    myOrders: ["📦 My Orders"],
    support: ["💬 Help & Support"],
  },

  welcome: (name) =>
    `✨ <b>Hey ${name || "there"}, welcome to IPDokan</b>\n` +
    `<i>Premium proxies, delivered right here in Telegram</i>\n` +
    `${LINE}\n\n` +
    `<blockquote>⚡ <b>Instant delivery</b>: credentials arrive a few seconds after you pay\n` +
    `🛡 <b>Fast & reliable</b>: premium high-speed proxies\n` +
    `📶 <b>Flexible plans</b>: pay per GB or per IP\n` +
    `🔐 <b>Secure checkout</b>: bKash · Nagad · Rocket · Binance</blockquote>\n\n` +
    `👇 Tap <b>⚡ Buy Proxy</b> to see the packages`,

  exitMessage:
    `👋 <b>Menu closed</b>\n\nType /start or tap <b>⚡ Buy Proxy</b> whenever you need us again.`,
  quickStart:
    `🚀 <b>Quick start</b>\n` +
    `<i>Choose what you want to do:</i>`,
  unknownMessage: (name) =>
    `🤔 Sorry ${name || "there"}, I didn't understand that.\n\n` +
    `Use the buttons below or the menu at the bottom of the chat.\n` +
    `<i>Tip: type /buy to start shopping right away.</i>`,
  loadError: (what = "data", detail = "") =>
    `😕 <b>Couldn't load ${what}</b>\n\n` +
    `${detail ? `${detail} ` : ""}Our store might be busy. Tap <b>🔄 Try Again</b> in a moment.`,
  orderCreateError:
    `😕 <b>Couldn't create your order</b>\n\n` +
    `Nothing was charged. Tap <b>🔄 Try Again</b>, and if it keeps failing, type /support.`,

  selectCategory:
    `🗂 <b>CHOOSE A CATEGORY</b>\n<i>Start here</i>\n\n${steps(1)}\n${LINE}\n\n` +
    `Pick the type of proxy you need.\n<i>The number shows how many products are in each category.</i>`,
  selectProduct: (categoryName) =>
    `🏷 <b>CHOOSE A PRODUCT</b>\n<i>in ${categoryName}</i>\n\n${steps(2)}\n${LINE}\n\n` +
    `Choose a brand or product:`,
  selectPlan: (productName) =>
    `📦 <b>CHOOSE A PACKAGE</b>\n<i>for ${productName}</i>\n\n${steps(3)}\n${LINE}\n\n` +
    `Choose a package.\n<i>🟢 10+ in stock · 🟡 fewer than 10 left · 🔴 sold out</i>`,
  selectQuantity: (productName, planLabel, unitPrice, quantity, currency) =>
    `🔢 <b>CHOOSE QUANTITY</b>\n<i>${productName}</i>\n\n${steps(4)}\n${LINE}\n\n` +
    `📦 <b>Package:</b> ${planLabel}\n` +
    `💵 <b>Unit price:</b> ${unitPrice} ${currency}\n\n` +
    `<blockquote>🔢 <b>Quantity:</b> ${quantity}\n` +
    `🧮 ${unitPrice} ${currency} × ${quantity}\n` +
    `💰 <b>Total: ${formatMoney(unitPrice * quantity)} ${currency}</b></blockquote>\n\n` +
    `<i>Use ➖ / ➕ or a preset, then tap Confirm.</i>`,

  orderSummary: (brandName, planLabel, price, currency, orderId, quantity = 1) =>
    `💳 <b>COMPLETE PAYMENT</b>\n<i>Your order is ready</i>\n\n${steps(5)}\n${LINE}\n\n` +
    `<blockquote>🏷 <b>Provider:</b> ${brandName}\n` +
    `📦 <b>Package:</b> ${planLabel}` +
    `${quantity > 1 ? `\n🔢 <b>Quantity:</b> ${quantity}` : ""}\n` +
    `🆔 <b>Order ID:</b> <code>${orderId}</code></blockquote>\n\n` +
    `💰 <b>Total to pay:</b> <b>${price} ${currency}</b>\n${THIN}\n` +
    `💳 Tap <b>Pay Securely</b> below to finish on our website.\n` +
    `<i>bKash · Nagad · Rocket · Binance · Wallet</i>\n\n` +
    `⚡ Your proxy will appear in this chat as soon as payment is confirmed.`,
  payButtonText: (amount, currency) => `💳 Pay Securely · ${amount} ${currency}`,
  cancelButtonText: "✖️ Cancel Order",
  orderCancelled:
    `🚫 <b>Order cancelled</b>\n\nNothing was charged. Tap <b>⚡ Buy Proxy</b> whenever you want to start a new order.`,
  outOfStockAlert:
    `😔 <b>Sold out</b>\n\nThis package is out of stock right now. Please pick another package.`,

  deliverySuccess: (brandName, planLabel, credentials, orderId, quantity = 1, part = "") =>
    `🎉 <b>Your proxy is ready!</b>${part ? ` <i>(${part})</i>` : ""}\n${LINE}\n\n` +
    `<blockquote>🏷 <b>Provider:</b> ${brandName}\n` +
    `📦 <b>Package:</b> ${planLabel}` +
    `${quantity > 1 ? `\n🔢 <b>Quantity:</b> ${quantity}` : ""}\n` +
    `🆔 <b>Order ID:</b> <code>${orderId}</code></blockquote>\n\n` +
    `🔑 <b>Credentials</b>\n` +
    `<pre><code class="language-proxy">${credentials}</code></pre>\n\n` +
    `<i>👆 Tap the block to copy it. Thanks for choosing IPDokan 💜</i>`,
  orderPaidWaiting: (orderId, brandName, planLabel) =>
    `✅ <b>Payment received</b>\n${LINE}\n\n` +
    `<blockquote>🆔 <b>Order:</b> <code>${orderId}</code>\n` +
    `📦 <b>Package:</b> ${brandName} · ${planLabel}</blockquote>\n\n` +
    `⏳ Our team is preparing your proxy. It will appear in this chat shortly.`,
  outOfStockPaid: (orderId) =>
    `⚠️ <b>Order #${orderId}: payment received</b>\n${LINE}\n\n` +
    `Your payment went through, but this package ran out of instant stock a moment ago.\n\n` +
    `<blockquote>🔔 Our admin has already been notified\n` +
    `⏱ Your proxy will be assigned to you shortly</blockquote>\n\n` +
    `Need help? Type /support`,

  noOrders:
    `📭 <b>No orders yet</b>\n\nTap <b>⚡ Buy Proxy</b> to place your first order.`,
  myOrdersHeader: `🧾 <b>Your Recent Orders</b>\n${LINE}\n`,
  userOrdersCleared: (count) =>
    `🗑 <b>${count}</b> unpaid order${count === 1 ? " was" : "s were"} removed from your cart.`,
  noPendingOrders: "ℹ️ You have no unpaid orders in your cart.",
  orderCancelUnavailable:
    "⚠️ This order can't be cancelled anymore. Contact support if you need help after paying.",
  orderItem: (order, brandName, planLabel) =>
    `\n${statusIcon(order.status)} <b>${brandName}</b> · ${planLabel}\n` +
    `<blockquote>🆔 <code>${order.orderId}</code>\n` +
    `💰 ${order.amount} ${order.currency}` +
    `${order.quantity > 1 ? `  ·  🔢 ×${order.quantity}` : ""}\n` +
    `📊 ${formatStatus(order.status)}  ·  📅 ${new Date(order.createdAt).toLocaleDateString()}</blockquote>` +
    `${order.deliveredCredentials ? `\n🔑 <b>Credentials</b>\n<blockquote expandable><code>${order.deliveredCredentials}</code></blockquote>` : ""}\n`,

  support: (contact = "@ipdokan") =>
    `💬 <b>Help & Support</b>\n${LINE}\n\n` +
    `Problem with a proxy or a payment? Open a <b>🎫 ticket</b> and our team will reply right here.\n\n` +
    `<blockquote>👤 <b>Telegram:</b> ${contact}\n` +
    `🌐 <b>Website:</b> https://ipdokan.com</blockquote>\n\n` +
    `📝 <i>Include your <b>Order ID</b> so we can help faster.</i>`,

  adminStats: (stats) =>
    `📊 <b>IPDokan · Sales & Stock</b>\n${LINE}\n\n` +
    `☀️ <b>Today</b>\n` +
    `<blockquote>💰 Revenue: <b>${stats.todayRevenue} ${stats.currency}</b>\n` +
    `📦 Orders: <b>${stats.todayOrders}</b></blockquote>\n\n` +
    `📈 <b>Last 7 days</b>\n` +
    `<blockquote>💰 Revenue: <b>${stats.weekRevenue} ${stats.currency}</b>\n` +
    `📦 Orders: <b>${stats.weekOrders}</b></blockquote>\n\n` +
    `💎 <b>All time</b>\n` +
    `<blockquote>💰 Revenue: <b>${stats.totalRevenue} ${stats.currency}</b>\n` +
    `📦 Orders: <b>${stats.totalOrders}</b>\n` +
    `👥 Customers: <b>${stats.totalUsers}</b></blockquote>\n\n` +
    `${stats.lowStockCount > 0 ? "⚠️" : "✅"} <b>Low stock:</b> ${stats.lowStockCount} package${stats.lowStockCount === 1 ? "" : "s"} need restocking`,
  adminOnly: "⛔ Only admins can use this command.",
};

function statusIcon(status) {
  switch (status) {
    case "delivered":
    case "completed": return "🟢";
    case "paid":
    case "processing": return "🟣";
    case "stock_pending": return "🟡";
    case "pending": return "⚪️";
    case "failed": return "🔴";
    case "cancelled": return "⚫️";
    default: return "⚪️";
  }
}

function formatStatus(status) {
  switch (status) {
    case "delivered": return "Delivered";
    case "completed": return "Completed";
    case "paid":
    case "processing": return "Paid · Processing";
    case "stock_pending": return "Preparing stock";
    case "pending": return "Awaiting payment";
    case "failed": return "Failed";
    case "cancelled": return "Cancelled";
    default: return status;
  }
}

function formatMoney(n) {
  return Math.round(n * 100) / 100;
}
