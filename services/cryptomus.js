/**
 * Cryptomus crypto checkout (https://doc.cryptomus.com/merchant-api), in USD.
 *
 *   createInvoice() -> hosted payment url (USDT, BTC, …)
 *   getInvoice()    -> real status from Cryptomus (paid / paid_over / check / …)
 *
 * Requests are signed with md5(base64(json) + payment key). Cryptomus signs
 * PHP json_encode output, which escapes "/" as "\/", so the JSON is built the
 * same way. Webhooks are signature-checked, but the status is always re-read
 * from Cryptomus before anything is delivered.
 */
const crypto = require("crypto");
const axios = require("axios");

const BASE_URL = (process.env.CRYPTOMUS_BASE_URL || "https://api.cryptomus.com").replace(/\/$/, "");
const INVOICE_LIFETIME_SECONDS = 60 * 60;
const PAID_STATUSES = new Set(["paid", "paid_over"]);
// Invoice is dead (cancelled / expired / failed): the order can get a new one
const FAILED_STATUSES = new Set(["cancel", "fail", "system_fail", "refund_paid"]);
// Money arrived but not the right amount: needs a human
const NEEDS_REVIEW_STATUSES = new Set(["wrong_amount", "wrong_amount_waiting"]);

function merchantId() {
  return (process.env.CRYPTOMUS_MERCHANT_ID || "").trim();
}
function paymentKey() {
  return (process.env.CRYPTOMUS_PAYMENT_KEY || "").trim();
}
function isConfigured() {
  return Boolean(merchantId() && paymentKey());
}

function phpJson(value) {
  return JSON.stringify(value).replace(/\//g, "\\/");
}

function signOf(json) {
  return crypto
    .createHash("md5")
    .update(Buffer.from(json).toString("base64") + paymentKey())
    .digest("hex");
}

async function call(path, body) {
  if (!isConfigured()) throw new Error("CRYPTOMUS_MERCHANT_ID / CRYPTOMUS_PAYMENT_KEY are not set in .env");
  const json = phpJson(body);
  let data;
  try {
    const res = await axios.post(`${BASE_URL}${path}`, json, {
      headers: { "Content-Type": "application/json", merchant: merchantId(), sign: signOf(json) },
      timeout: 20000,
    });
    data = res.data;
  } catch (err) {
    data = err.response?.data;
    if (!data) throw new Error(`Cryptomus ${path} failed: ${err.message}`);
  }
  if (data?.state !== 0 || !data.result) {
    const detail = data?.message || (data?.errors ? JSON.stringify(data.errors) : "unknown error");
    throw new Error(`Cryptomus ${path} failed: ${detail}`);
  }
  return data.result;
}

/**
 * Cryptomus order_id for one payment attempt of our order (letters, digits,
 * - and _ only). Unique per attempt: Cryptomus won't reuse an order_id after
 * its invoice was cancelled or expired.
 */
function cryptomusOrderId(order) {
  const attempt = crypto.randomBytes(3).toString("hex");
  return `tg_${String(order.orderId).replace(/[^A-Za-z0-9_-]/g, "")}_${attempt}`;
}

/**
 * Creates a USD invoice for an order.
 * @returns {Promise<{success: boolean, redirectUrl?: string, invoiceId?: string, error?: string, raw?: Object}>}
 */
async function createInvoice(order) {
  const appBaseUrl = (process.env.APP_BASE_URL || "http://localhost:5001").replace(/\/$/, "");
  const returnBase = (process.env.CRYPTOMUS_RETURN_URL || process.env.ZINIPAY_REDIRECT_URL || `${appBaseUrl}/payment/success`).trim();
  const withOrder = (u) => `${u}${u.includes("?") ? "&" : "?"}order_id=${encodeURIComponent(order.orderId)}`;

  const cmOrderId = cryptomusOrderId(order);
  const invoice = await call("/v1/payment", {
    amount: Number(order.amountUsd).toFixed(2),
    currency: "USD",
    order_id: cmOrderId,
    url_return: withOrder(returnBase),
    url_success: withOrder(returnBase),
    // Cryptomus refuses some callback hosts ("Request contains forbidden input"),
    // e.g. *.sslip.io, so the callback can be routed through the shop's domain.
    url_callback: (process.env.CRYPTOMUS_CALLBACK_URL || `${appBaseUrl}/webhook/cryptomus`).trim(),
    lifetime: INVOICE_LIFETIME_SECONDS,
    additional_data: `telegram:${order.telegramId}`,
  });
  if (typeof invoice.url !== "string") {
    return { success: false, error: "Cryptomus did not return a payment URL.", raw: invoice };
  }
  return { success: true, redirectUrl: invoice.url, invoiceId: cmOrderId, raw: invoice };
}

/**
 * Reads an invoice's real status from Cryptomus.
 * @returns {Promise<{status: string, paid: boolean, failed: boolean, amount: number, currency: string, orderId: string, raw: Object}>}
 */
async function getInvoice(cryptomusId) {
  const invoice = await call("/v1/payment/info", { order_id: String(cryptomusId) });
  const status = String(invoice.payment_status || invoice.status || "").toLowerCase();
  return {
    status,
    paid: PAID_STATUSES.has(status),
    failed: FAILED_STATUSES.has(status),
    needsReview: NEEDS_REVIEW_STATUSES.has(status),
    amount: Number(invoice.amount),
    currency: String(invoice.currency || "").toUpperCase(),
    orderId: String(invoice.order_id || ""),
    raw: invoice,
  };
}

/** True when a webhook body carries a valid Cryptomus signature. */
function webhookSignatureValid(body) {
  if (!body || typeof body.sign !== "string" || !isConfigured()) return false;
  const { sign, ...data } = body;
  const expected = signOf(phpJson(data));
  return sign.length === expected.length && crypto.timingSafeEqual(Buffer.from(sign), Buffer.from(expected));
}

module.exports = { createInvoice, getInvoice, webhookSignatureValid, isConfigured, cryptomusOrderId };
