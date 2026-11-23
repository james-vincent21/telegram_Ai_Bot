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

module.exports = {
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
    `Problem with a proxy or a payment? Tap a button below to reach us.\n\n` +
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
