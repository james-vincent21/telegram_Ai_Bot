const mongoose = require('mongoose');

const brandSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
      unique: true,
    },
    emoji: {
      type: String,
      default: '🌐',
      trim: true,
    },
    description: {
      type: String,
      default: '',
    },
    // Linked ipdokan.com product (set by the catalog sync)
    ipdokanProductId: { type: String, default: null, index: true },
    // Locations the customer can choose for this product (from ipdokan.com)
    locations: { type: [{ _id: false, id: String, name: String }], default: [] },
    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },
    displayOrder: {
      type: Number,
      default: 0,
    },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.models.Brand || mongoose.model('Brand', brandSchema);
