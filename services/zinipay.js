/**
 * ZiniPay hosted checkout (https://zinipay.com/docs).
 *
 *   createInvoice() -> payment_url on secure.zinipay.com (bKash / Nagad / …)
 *   verifyInvoice() -> PENDING | COMPLETED | FAILED, straight from ZiniPay
 *
 * ZiniPay's webhook carries only invoice_id + status and is not signed, so the
 * bot never trusts it: every webhook / return / poll calls verifyInvoice().
 */
const axios = require("axios");

const BASE_URL = (process.env.ZINIPAY_BASE_URL || "https://api.zinipay.com").replace(/\/$/, "");

function apiKey() {
  const key = (process.env.ZINIPAY_API_KEY || "").trim();
  if (!key) throw new Error("ZINIPAY_API_KEY is not set in .env");
  return key;
}

function isConfigured() {
  return Boolean((process.env.ZINIPAY_API_KEY || "").trim());
}

async function call(path, body) {
  try {
    const res = await axios.post(`${BASE_URL}${path}`, body, {
      headers: { "Content-Type": "application/json", "zini-api-key": apiKey() },
      timeout: 20000,
    });
    return res.data;
  } catch (err) {
    const detail = err.response?.data?.message || err.response?.data?.error || err.message;
    throw new Error(`ZiniPay ${path} failed: ${detail}`);
  }
}

/** Invoice id is the last path segment of payment_url (…/payment/<INVOICE_ID>). */
function invoiceIdFromUrl(paymentUrl) {
  try {
    return new URL(paymentUrl).pathname.split("/").filter(Boolean).pop() || null;
  } catch {
    return null;
  }
}

/**
 * Creates a hosted invoice for an order.
 * @returns {Promise<{success: boolean, redirectUrl?: string, invoiceId?: string, error?: string, raw?: Object}>}
 */
async function createInvoice(order, customer = {}) {
  const appBaseUrl = (process.env.APP_BASE_URL || "http://localhost:5001").replace(/\/$/, "");
  const orderParam = `order_id=${encodeURIComponent(order.orderId)}`;
  // ZiniPay requires redirect_url to be on the brand's website domain.
  // ZINIPAY_REDIRECT_URL lets the brand's own site be used (e.g. https://ipdokan.com/).
  const redirectBase = (process.env.ZINIPAY_REDIRECT_URL || `${appBaseUrl}/payment/success`).trim();
  const cancelBase = (process.env.ZINIPAY_CANCEL_URL || `${appBaseUrl}/payment/cancel`).trim();
  const withOrder = (u) => `${u}${u.includes("?") ? "&" : "?"}${orderParam}`;

  const data = await call("/v1/payment/create", {
    amount: Number(order.amount),
    cus_name: customer.name || order.telegramFirstName || order.telegramUsername || `User ${order.telegramId}`,
    ...(customer.email ? { cus_email: customer.email } : {}),
    metadata: { order_id: order.orderId, telegram_id: String(order.telegramId) },
    redirect_url: withOrder(redirectBase),
    cancel_url: withOrder(cancelBase),
    webhook_url: `${appBaseUrl}/webhook/zinipay?${orderParam}`,
  });

  const paymentUrl = data?.payment_url;
  if (!data?.status || !paymentUrl) {
    return { success: false, error: data?.message || "No payment_url returned", raw: data };
  }
  return { success: true, redirectUrl: paymentUrl, invoiceId: invoiceIdFromUrl(paymentUrl), raw: data };
}

/**
 * Asks ZiniPay for an invoice's real status.
 * @returns {Promise<{status: "PENDING"|"COMPLETED"|"FAILED"|string, amount: number|null, raw: Object}>}
 */
async function verifyInvoice(invoiceId) {
  const data = await call("/v1/payment/verify", { invoice_id: String(invoiceId) });
  const amount = data?.amount != null ? Number(data.amount) : null;
  return { status: String(data?.status || "").toUpperCase(), amount, raw: data };
}

module.exports = { createInvoice, verifyInvoice, isConfigured, invoiceIdFromUrl };
