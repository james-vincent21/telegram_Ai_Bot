require('dotenv').config();
const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const path = require('path');
const connectDB = require('./db');

const webhookRoutes = require('./routes/webhook');
const apiRoutes = require('./routes/api');
const shopRoutes = require('./routes/shop');
const mongoose = require('mongoose');
const broadcastService = require('../services/broadcast');

const app = express();
const PORT = process.env.PORT || 5001;

// Connect to MongoDB
connectDB();
// Broadcasts cut off by a restart are marked so the admin can see it
mongoose.connection.once('open', () => broadcastService.markInterrupted());

// Global Middlewares
app.use(cors());
app.use(morgan('dev'));

// Note: SSLCommerz IPN sends application/x-www-form-urlencoded
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(express.json({ limit: '10mb' }));

// Health Check
app.get('/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

// Mount Routes
app.use('/', webhookRoutes);
app.use('/shop-api', shopRoutes);
app.use('/api', apiRoutes);

// Telegram Mini App shop (needs an https address; set SHOP_URL=https://your-domain/shop/)
app.use('/shop', express.static(path.join(__dirname, 'public/shop')));

// Optional: Serve static build of admin panel in production if exists
const adminBuildPath = path.join(__dirname, '../admin-panel/dist');
app.use('/admin', express.static(adminBuildPath));
app.use('/assets', express.static(path.join(adminBuildPath, 'assets')));
app.get(['/admin', '/admin/*'], (req, res) => {
  res.sendFile(path.join(adminBuildPath, 'index.html'), (err) => {
    if (err) {
      res.status(404).send('Admin dashboard not built yet. Run npm run build inside /admin-panel.');
    }
  });
});

// Centralized error handler
app.use((err, req, res, next) => {
  console.error('Unhandled server error:', err);
  res.status(500).json({ error: err.message || 'Internal Server Error' });
});

app.listen(PORT, () => {
  console.log(`🚀 [Express Server] Listening on port ${PORT}`);
  console.log(`📡 [Payment Webhook] Ready at ${process.env.APP_BASE_URL || `http://localhost:${PORT}`}/webhook/payment-ipn`);
});

// Keep Brands / Plans in step with ipdokan.com so admins can upload stock
// for every product (also available on demand via POST /api/ipdokan/sync).
const catalog = require('../services/ipdokan');
const SYNC_EVERY_MS = 30 * 60 * 1000;
function syncCatalog() {
  catalog
    .syncToStore()
    .then(({ brands, plans }) => console.log(`🔄 [ipdokan] Synced ${brands} products / ${plans} packages`))
    .catch((err) => console.error('[ipdokan] Sync failed:', err.message));
}
setTimeout(syncCatalog, 5000);
setInterval(syncCatalog, SYNC_EVERY_MS).unref();

// Payment safety net: webhooks can be missed, so also ask ZiniPay / Cryptomus
// about recent unpaid orders every minute (delivery happens only once).
const Order = require('../models/Order');
const { checkOrderPayment } = require('./routes/webhook');
let paymentCheckRunning = false;
let paymentTick = 0;
async function checkPendingPayments() {
  if (paymentCheckRunning) return;
  paymentCheckRunning = true;
  try {
    // Every 15 s for orders from the last 30 min; every minute for older ones (up to 24 h)
    const fresh = paymentTick++ % 4 !== 0;
    const since = new Date(Date.now() - (fresh ? 30 * 60 * 1000 : 24 * 60 * 60 * 1000));
    const pending = await Order.find({
      paymentGateway: { $in: ['zinipay', 'cryptomus'] },
      status: 'pending',
      gatewayRedirectUrl: { $ne: null },
      createdAt: { $gte: since },
    })
      .sort({ createdAt: -1 })
      .limit(50);
    for (const order of pending) {
      await checkOrderPayment(order).catch((err) => console.error(`[Payment poll] ${order.orderId}:`, err.message));
    }
  } catch (err) {
    console.error('[Payment poll]', err.message);
  } finally {
    paymentCheckRunning = false;
  }
}
setInterval(checkPendingPayments, 15 * 1000).unref();

module.exports = app;
