/**
 * PDF payment memo (receipt) for paid orders, sent to the customer on Telegram.
 */
const PDFDocument = require("pdfkit");
const Order = require("../models/Order");

const STORE = {
  name: process.env.STORE_NAME || "IPDokan",
  website: (process.env.WOOCOMMERCE_URL || "https://ipdokan.com").replace(/\/$/, ""),
  support: process.env.SUPPORT_CONTACT || "@ipdokan",
};

const C = {
  violet: "#7438f0",
  fuchsia: "#d946ef",
  ink: "#16142e",
  text: "#272447",
  muted: "#76729c",
  line: "#e6e3f5",
  soft: "#f6f4ff",
  green: "#059669",
};

const PAID_STATUSES = ["paid", "processing", "completed", "delivered", "stock_pending"];

function money(n, currency = "BDT") {
  const v = Number(n || 0);
  return `${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`;
}

function fmtDate(d) {
  const date = d ? new Date(d) : new Date();
  return date.toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: process.env.STORE_TIMEZONE || "Asia/Dhaka",
  });
}

/** Builds the memo PDF and resolves with a Buffer. */
function buildReceiptPdf(order) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A5", margin: 36, info: { Title: `Memo ${order.orderId}` } });
    const chunks = [];
    doc.on("data", (c) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const W = doc.page.width;
    const L = 36;
    const R = W - 36;

    // Header band with gradient
    const grad = doc.linearGradient(0, 0, W, 0);
    grad.stop(0, C.violet).stop(1, C.fuchsia);
    doc.rect(0, 0, W, 96).fill(grad);
    doc.fillColor("#ffffff").font("Helvetica-Bold").fontSize(22).text(STORE.name, L, 28);
    doc.font("Helvetica").fontSize(9).fillColor("#f3e8ff").text("Premium proxy store", L, 56);
    doc.font("Helvetica-Bold").fontSize(15).fillColor("#ffffff").text("PAYMENT MEMO", L, 30, { width: R - L, align: "right" });
    doc.font("Helvetica").fontSize(9).fillColor("#f3e8ff").text(order.orderId, L, 52, { width: R - L, align: "right" });

    // PAID stamp
    let y = 116;
    doc.roundedRect(R - 70, y, 70, 22, 11).fill(C.green);
    doc.fillColor("#ffffff").font("Helvetica-Bold").fontSize(10).text("PAID", R - 70, y + 6, { width: 70, align: "center" });

    // Memo details + customer
    doc.fillColor(C.muted).font("Helvetica").fontSize(8);
    doc.text("MEMO DATE", L, y);
    doc.text("BILLED TO", L + 170, y);
    doc.fillColor(C.ink).font("Helvetica-Bold").fontSize(10);
    doc.text(fmtDate(order.updatedAt || order.createdAt), L, y + 12);
    const customer = order.telegramUsername ? `@${order.telegramUsername}` : order.telegramFirstName || "Customer";
    doc.text(customer, L + 170, y + 12, { width: 150 });
    doc.font("Helvetica").fontSize(8).fillColor(C.muted).text(`Telegram ID: ${order.telegramId}`, L + 170, y + 26);

    y += 50;
    const meta = [
      ["Order ID", order.orderId],
      ["Website order", order.wooOrderId && !String(order.wooOrderId).startsWith("DIRECT-") ? `#${order.wooOrderId}` : "-"],
      ["Transaction ID", order.gatewayTransactionId || "-"],
    ];
    meta.forEach(([k, v], i) => {
      const x = L + i * ((R - L) / 3);
      doc.fillColor(C.muted).font("Helvetica").fontSize(8).text(k.toUpperCase(), x, y);
      doc.fillColor(C.text).font("Helvetica-Bold").fontSize(9).text(String(v), x, y + 12, { width: (R - L) / 3 - 6 });
    });

    // Items table
    y += 44;
    doc.roundedRect(L, y, R - L, 24, 6).fill(C.soft);
    doc.fillColor(C.violet).font("Helvetica-Bold").fontSize(8);
    // item 10..160 | qty 160..190 | unit 190..262 | total 268..338 (relative to L)
    const cols = { item: L + 10, itemW: 148, qty: L + 160, unit: L + 190, total: L + 268 };
    doc.text("ITEM", cols.item, y + 8);
    doc.text("QTY", cols.qty, y + 8, { width: 30, align: "center" });
    doc.text("UNIT PRICE", cols.unit, y + 8, { width: 72, align: "right" });
    doc.text("TOTAL", cols.total, y + 8, { width: 70, align: "right" });

    y += 32;
    const qty = order.quantity || 1;
    const unit = order.unitPrice != null ? order.unitPrice : order.amount / qty;
    doc.fillColor(C.ink).font("Helvetica-Bold").fontSize(10).text(order.productName || "Proxy", cols.item, y, { width: cols.itemW });
    const itemH = doc.heightOfString(order.productName || "Proxy", { width: cols.itemW });
    doc.fillColor(C.muted).font("Helvetica").fontSize(8).text(order.variationName || "Package", cols.item, y + itemH + 2, { width: cols.itemW });
    doc.fillColor(C.text).font("Helvetica").fontSize(9);
    doc.text(String(qty), cols.qty, y, { width: 30, align: "center" });
    doc.text(money(unit, order.currency), cols.unit, y, { width: 72, align: "right" });
    doc.font("Helvetica-Bold").text(money(order.amount, order.currency), cols.total, y, { width: 70, align: "right" });

    y += Math.max(36, itemH + 22);
    doc.moveTo(L, y).lineTo(R, y).lineWidth(1).strokeColor(C.line).stroke();

    // Totals
    y += 12;
    const row = (label, value, bold = false) => {
      doc.fillColor(bold ? C.ink : C.muted).font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(bold ? 12 : 9);
      doc.text(label, R - 200, y, { width: 110, align: "right" });
      doc.text(value, R - 90, y, { width: 90, align: "right" });
      y += bold ? 20 : 15;
    };
    row("Subtotal", money(order.amount, order.currency));
    row("Discount", money(0, order.currency));
    y += 4;
    doc.roundedRect(R - 210, y - 6, 210, 30, 8).fill(C.soft);
    y += 2;
    row("Total paid", money(order.amount, order.currency), true);

    // Footer
    const fy = doc.page.height - 86;
    doc.moveTo(L, fy).lineTo(R, fy).lineWidth(1).strokeColor(C.line).stroke();
    doc.fillColor(C.text).font("Helvetica-Bold").fontSize(9).text("Thank you for your purchase!", L, fy + 12);
    doc.fillColor(C.muted).font("Helvetica").fontSize(8)
      .text(`Support: ${STORE.support}   ·   ${STORE.website}`, L, fy + 26)
      .text("This memo was generated automatically and is valid without a signature.", L, fy + 40);

    doc.end();
  });
}

/**
 * Sends the memo once per order. Safe to call many times (webhooks repeat):
 * only the first call that "claims" receiptSentAt actually sends.
 * @param {import('telegraf').Telegram} telegram
 * @param {object} order - Order document
 * @param {{force?: boolean}} [opts] - force: resend (customer asked for it)
 */
async function sendReceipt(telegram, order, opts = {}) {
  if (!order || !order.telegramId || !PAID_STATUSES.includes(order.status)) return false;

  let fresh = order;
  if (!opts.force) {
    fresh = await Order.findOneAndUpdate(
      { _id: order._id, receiptSentAt: null },
      { $set: { receiptSentAt: new Date() } },
      { new: true },
    );
    if (!fresh) return false; // already sent
  }

  try {
    const pdf = await buildReceiptPdf(fresh);
    await telegram.sendDocument(
      fresh.telegramId,
      { source: pdf, filename: `IPDokan-Memo-${fresh.orderId}.pdf` },
      {
        caption: `🧾 <b>Payment memo</b> · <code>${fresh.orderId}</code>\n<i>Keep this PDF as proof of payment.</i>`,
        parse_mode: "HTML",
      },
    );
    return true;
  } catch (err) {
    console.error(`[Receipt] Could not send memo for ${fresh.orderId}:`, err.message);
    if (!opts.force) {
      // Allow a later retry
      await Order.updateOne({ _id: fresh._id }, { $set: { receiptSentAt: null } }).catch(() => {});
    }
    return false;
  }
}

module.exports = { buildReceiptPdf, sendReceipt, PAID_STATUSES };
