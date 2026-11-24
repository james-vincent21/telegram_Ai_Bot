const mongoose = require("mongoose");

const orderSchema = new mongoose.Schema(
  {
    orderId: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    wooOrderId: {
      type: String,
      default: null,
      index: true,
    },
    wooProductId: {
      type: mongoose.Schema.Types.Mixed, // number (old WooCommerce) or hex string (ipdokan.com)
      default: null,
    },
    wooVariationId: {
      type: mongoose.Schema.Types.Mixed, // number (old WooCommerce) or hex string (ipdokan.com)
      default: null,
    },
    // Location the customer chose (ipdokan products with chooseLocation)
    locationId: { type: String, default: null },
    locationName: { type: String, default: "" },
    productName: {
      type: String,
      default: "",
    },
    variationName: {
      type: String,
      default: "",
    },
    proxyType: {
      type: String,
      enum: ["gb", "ip", "other"],
      default: "gb",
    },
    telegramId: {
      type: Number,
      required: true,
      index: true,
    },
    telegramUsername: {
      type: String,
      default: "",
    },
    telegramFirstName: {
      type: String,
      default: "",
    },
    brandId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Brand",
      required: false,
    },
    planId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Plan",
      required: false,
    },
    quantity: {
      type: Number,
      default: 1,
      min: 1,
    },
    unitPrice: {
      type: Number,
      default: null,
    },
    amount: {
      type: Number,
      required: true,
      min: 0,
    },
    currency: {
      type: String,
      default: "BDT",
    },
    gatewayTransactionId: {
      type: String,
      required: false,
      sparse: true,
    },
    gatewayRedirectUrl: {
      type: String,
      default: null,
    },
    status: {
      type: String,
      enum: [
        "pending",
        "paid",
        "processing",
        "completed",
        "delivered",
        "stock_pending",
        "failed",
        "cancelled",
      ],
      default: "pending",
      index: true,
    },
    deliveredStockId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Stock",
      default: null,
    },
    deliveredStockIds: {
      type: [mongoose.Schema.Types.ObjectId],
      ref: "Stock",
      default: [],
    },
    deliveredCredentials: {
      type: String,
      default: null,
    },
    deliveredAt: {
      type: Date,
      default: null,
    },
    gatewayResponse: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
    // When the proxy runs out (set automatically on delivery, see below)
    expiresAt: {
      type: Date,
      default: null,
      index: true,
    },
    durationDays: {
      type: Number,
      default: null,
    },
    expiryReminderSentAt: {
      type: Date,
      default: null,
    },
    // PDF memo sent to the customer after payment
    receiptSentAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
  },
);

const DEFAULT_PROXY_DAYS = () => parseInt(process.env.DEFAULT_PROXY_DAYS || "30", 10);

/**
 * Reads a duration from a package name: "30 Days", "1 Month", "2 weeks",
 * "7D", "1 Year". Returns null when the name has none.
 */
function parseDurationDays(...names) {
  const text = names.filter(Boolean).join(" ").toLowerCase();
  const m = text.match(/(\d+)\s*(days?|d\b|weeks?|w\b|months?|mo\b|m\b|years?|y\b)/);
  if (!m) return null;
  const n = parseInt(m[1], 10);
  const unit = m[2];
  if (unit.startsWith("w")) return n * 7;
  if (unit.startsWith("mo") || unit === "m" || unit.startsWith("month")) return n * 30;
  if (unit.startsWith("y")) return n * 365;
  return n;
}

// Set the expiry date the first time an order is marked as delivered
orderSchema.pre("save", function setExpiry(next) {
  if (this.status === "delivered" && this.deliveredAt && !this.expiresAt) {
    const days =
      this.durationDays ||
      parseDurationDays(this.variationName, this.productName) ||
      DEFAULT_PROXY_DAYS();
    this.durationDays = days;
    this.expiresAt = new Date(this.deliveredAt.getTime() + days * 24 * 60 * 60 * 1000);
  }
  next();
});

orderSchema.statics.parseDurationDays = parseDurationDays;

module.exports = mongoose.models.Order || mongoose.model("Order", orderSchema);
