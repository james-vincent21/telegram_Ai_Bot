/**
 * Client for ipdokan.com's bot bridge (backend/routes/bot.routes.js on the
 * website), so bot sales use the website's own inventory:
 *   create  -> website order; codes are reserved (or a supplier plan is ordered)
 *   paid    -> codes are marked sold and returned for delivery in Telegram
 *   failed  -> payment failed / cancelled at the gateway: admins see "Payment failed", codes go back
 *   cancel  -> reservation released, codes go back to stock
 *
 * Runs on the same server: SITE_API_URL defaults to http://127.0.0.1:4000/api/bot
 * and SITE_BOT_SECRET must equal BOT_API_SECRET in the website's .env.
 */
const axios = require("axios");

const BASE_URL = (process.env.SITE_API_URL || "http://127.0.0.1:4000/api/bot").replace(/\/$/, "");

function isConfigured() {
  return (process.env.SITE_BOT_SECRET || "").length >= 32;
}

async function call(method, path, body) {
  try {
    const res = await axios({
      method,
      url: `${BASE_URL}${path}`,
      data: body,
      headers: { "Content-Type": "application/json", "X-Bot-Secret": process.env.SITE_BOT_SECRET },
      timeout: 60000, // supplier orders can take a while
    });
    return { ok: true, status: res.status, data: res.data };
  } catch (err) {
    return {
      ok: false,
      status: err.response?.status || 0,
      data: err.response?.data || null,
      error: err.response?.data?.error || err.message,
    };
  }
}

/**
 * Creates the website order. currency: "BDT" (ZiniPay) or "USD" (Cryptomus).
 * @returns {Promise<{ok: boolean, order?: {id, amount, currency, status}, error?: string, status?: number}>}
 */
async function create({ telegramId, name, productId, variantId, locationId, quantity, currency, whitelistIp }) {
  const r = await call("post", "/orders", {
    telegramId,
    name,
    productId,
    variantId: variantId || undefined,
    locationId: locationId || undefined,
    quantity,
    currency,
    whitelistIp: whitelistIp || undefined,
  });
  return r.ok ? { ok: true, order: r.data.order } : r;
}

/** The customer was sent to the payment page; `method` ("zinipay" | "cryptomus") is shown to admins. */
async function started(siteOrderId, holdMinutes = 0, method = "") {
  return call("post", `/orders/${siteOrderId}/started`, { holdMinutes, method });
}

/** @returns {Promise<{ok, order?: {status, deliveredCodes: string[], supplierDeliveryPending, supplierError}, error?: string}>} */
async function paid(siteOrderId, method, reference, channel = "") {
  const r = await call("post", `/orders/${siteOrderId}/paid`, { method, reference, channel });
  return r.ok ? { ok: true, order: r.data.order, error: r.data.error || "" } : r;
}

/**
 * The payment failed or was cancelled / expired at the gateway: the website order is cancelled with
 * `reason` (admins see "Payment failed") and its reserved codes go back to stock.
 */
async function failed(siteOrderId, method, reason, channel = "") {
  return call("post", `/orders/${siteOrderId}/failed`, { method, reason, channel });
}

async function cancel(siteOrderId) {
  return call("post", `/orders/${siteOrderId}/cancel`, {});
}

async function get(siteOrderId) {
  const r = await call("get", `/orders/${siteOrderId}`);
  return r.ok ? { ok: true, order: r.data.order } : r;
}

/** True for products that come from ipdokan.com (24-char hex ids). */
function isSiteProduct(productId) {
  return /^[a-f0-9]{24}$/i.test(String(productId || ""));
}

module.exports = { isConfigured, isSiteProduct, create, started, paid, failed, cancel, get };
