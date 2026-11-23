const mongoose = require("mongoose");

const messageSchema = new mongoose.Schema(
  {
    from: { type: String, enum: ["user", "admin"], required: true },
    text: { type: String, required: true, maxlength: 4000 },
    adminName: { type: String, default: "" },
    at: { type: Date, default: Date.now },
  },
  { _id: false },
);

const ticketSchema = new mongoose.Schema(
  {
    ticketNo: { type: String, required: true, unique: true, index: true },
    telegramId: { type: Number, required: true, index: true },
    telegramUsername: { type: String, default: "" },
    telegramFirstName: { type: String, default: "" },
    orderId: { type: String, default: "" },
    // open = waiting for admin, answered = waiting for customer, closed = done
    status: {
      type: String,
      enum: ["open", "answered", "closed"],
      default: "open",
      index: true,
    },
    messages: { type: [messageSchema], default: [] },
    lastMessageAt: { type: Date, default: Date.now, index: true },
  },
  { timestamps: true },
);

/** Short human-friendly number, e.g. T-48213 */
ticketSchema.statics.newTicketNo = async function newTicketNo() {
  for (let i = 0; i < 5; i++) {
    const no = `T-${Math.floor(10000 + Math.random() * 90000)}`;
    if (!(await this.exists({ ticketNo: no }))) return no;
  }
  return `T-${Date.now().toString().slice(-7)}`;
};

module.exports = mongoose.models.Ticket || mongoose.model("Ticket", ticketSchema);
