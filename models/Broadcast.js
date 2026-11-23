const mongoose = require("mongoose");

const broadcastSchema = new mongoose.Schema(
  {
    text: { type: String, required: true, maxlength: 4000 },
    buttonText: { type: String, default: "" },
    buttonUrl: { type: String, default: "" },
    addShopButton: { type: Boolean, default: false },
    audience: { type: String, enum: ["all", "buyers"], default: "all" },
    status: {
      type: String,
      enum: ["sending", "done", "stopped", "interrupted"],
      default: "sending",
      index: true,
    },
    total: { type: Number, default: 0 },
    sent: { type: Number, default: 0 },
    failed: { type: Number, default: 0 },
    blocked: { type: Number, default: 0 },
    createdBy: { type: String, default: "" },
    finishedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

module.exports = mongoose.models.Broadcast || mongoose.model("Broadcast", broadcastSchema);
