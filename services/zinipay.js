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
    const data = err.response?.data;
    // e.g. {"message":"Invalid request data","errors":[{"field":"body.cus_email","message":"Required"}]}
    const fields = Array.isArray(data?.errors) ? data.errors.map((e) => `${e.field}: ${e.message}`).join("; ") : "";
    const detail = [data?.message || data?.error || err.message, fields].filter(Boolean).join(" — ");
    throw new Error(`ZiniPay ${path} failed: ${detail}`);
  }
}

function hostOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
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
  // ZiniPay requires redirect_url / cancel_url on the brand's website domain
  // (the "Website URL" of the brand in the ZiniPay dashboard), else it answers
  // "Domain mismatch". ZINIPAY_REDIRECT_URL points them at that site.
  const redirectBase = (process.env.ZINIPAY_REDIRECT_URL || `${appBaseUrl}/payment/success`).trim();
  const cancelBase = (process.env.ZINIPAY_CANCEL_URL || `${appBaseUrl}/payment/cancel`).trim();
  const withOrder = (u) => `${u}${u.includes("?") ? "&" : "?"}${orderParam}`;

  const data = await call("/v1/payment/create", {
    amount: Number(order.amount),
    cus_name: customer.name || order.telegramFirstName || order.telegramUsername || `User ${order.telegramId}`,
    // Required by ZiniPay (docs say optional). Telegram has no email, so use a placeholder on the brand domain.
    cus_email: customer.email || `tg${order.telegramId}@${hostOf(redirectBase) || "ipdokan.com"}`,
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
