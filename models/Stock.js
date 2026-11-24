const mongoose = require("mongoose");

const stockSchema = new mongoose.Schema(
  {
    wooProductId: {
      type: mongoose.Schema.Types.Mixed, // number (old WooCommerce) or hex string (ipdokan.com)
      default: null,
      index: true,
    },
    wooVariationId: {
      type: mongoose.Schema.Types.Mixed, // number (old WooCommerce) or hex string (ipdokan.com)
      default: null,
      index: true,
    },
    // Location this credential is for (null = any location)
    locationId: { type: String, default: null, index: true },
    locationName: { type: String, default: "" },
    productName: {
      type: String,
      default: "",
    },
    variationName: {
      type: String,
      default: "",
    },
    brandId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Brand",
      required: false,
      index: true,
    },
    planId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Plan",
      required: false,
      index: true,
    },
    credentials: {
      type: String,
      required: true,
      trim: true,
    },
    isUsed: {
      type: Boolean,
      default: false,
      index: true,
    },
    assignedToTelegramId: {
      type: Number,
      default: null,
      index: true,
    },
    assignedAt: {
      type: Date,
      default: null,
    },
    orderId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Order",
      default: null,
    },
    batchNote: {
      type: String,
      default: "",
    },
  },
  {
    timestamps: true,
  },
);

// Compound index for high-concurrency atomic stock claiming
stockSchema.index({ wooVariationId: 1, isUsed: 1 });
stockSchema.index({ wooProductId: 1, isUsed: 1 });
stockSchema.index({ brandId: 1, planId: 1, isUsed: 1 });

module.exports = mongoose.models.Stock || mongoose.model("Stock", stockSchema);
