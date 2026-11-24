# 🌐 IPDokan Telegram Proxy Store Bot & Admin Dashboard

A complete, production-ready Telegram e-commerce ecosystem built for **[ipdokan.com](https://ipdokan.com)**. Customers can browse **Proxy GB** (bandwidth/traffic packages) and **Proxy IP** (IP-count packages), pick brands (_9proxy, Cliproxy, 711Proxy, Loki Proxy, NovProxy, Proxy001, Supproxy, IPROCKET_), checkout via the website's payment gateway (bKash, Nagad, Rocket, Binance, Wallet), and receive proxy credentials automatically inside Telegram.

Includes a **React + Tailwind CSS** admin panel for tracking orders, managing proxy stock, and syncing products.

---

## 🚀 Key Features

- 🤖 **Telegram Bot (Telegraf + Node.js)**:
  - Welcome menu with interactive inline keyboard navigation.
  - **Live ipdokan.com catalog**: categories, products, packages, BDT prices, stock and **locations** come from `https://ipdokan.com/api/products` (public, cached 60s).
  - **Full purchase in Telegram**: category → product → package → 📍 location (when the package needs one) → quantity → SSLCommerz payment → credentials delivered in the chat.
  - **Mini App shop** (`/shop`): the same catalog, location picker and checkout inside Telegram.
  - **Out-of-Stock Protection**: sold-out packages and locations are shown in red and can't be ordered.
  - `/myorders` command displaying customer purchase history and delivered credentials.
  - Admin commands: `/stats` (live revenues & order totals) and `/addstock`.

- 🛒 **ipdokan.com + SSLCommerz**:
  - Catalog client in [`services/ipdokan.js`](services/ipdokan.js); every 30 min (and on **Sync with ipdokan.com**) products are mirrored into Brands (one per product, with its locations) and Plans (one per package).
  - Orders are paid with ZiniPay (bKash / Nagad / Rocket) or SSLCommerz. Every payment is verified with the gateway's API, the paid amount is checked, and the order is claimed atomically so it is delivered once.
  - Credentials are taken from the Stock uploaded for that package (and location) and sent straight to the customer's chat.

- ⚡ **Atomic Proxy Credential Management (MongoDB + Mongoose)**:
  - Concurrency-safe atomic credential reservation via `findOneAndUpdate({ isUsed: false })`.
  - When payment is received, the bot checks its credential pool for that product/variation and delivers it to the customer.
  - Location stock: credentials uploaded for the chosen location are used first, then ones marked "Any location".
  - If stock was not pre-uploaded in the bot, the admin is immediately alerted on Telegram with customer details and order ID, and the customer is politely informed that their proxy is being provisioned.

- 🎛 **Admin Web Dashboard (React + Vite + Tailwind CSS)**:
  - **Overview**: Revenue analytics (Today, Week, All-time), active order counts, low-stock warnings.
  - **Products**: Manage brands and packages, or hit **"Sync with ipdokan.com"** to pull all products and packages right away.
  - **Stock Inventory**: Bulk paste proxy credentials (one per line) or drag-and-drop text files; pick a 📍 Location for packages that are sold per location.
  - **Orders Audit**: View all orders, search by ID, @username, or Telegram ID, and manually fulfill/deliver proxies with one click.

---

## 📁 Project Structure

```
├── bot/
│   ├── config/strings.js       # Centralized user-facing copy (Bengali & English)
│   ├── handlers/
│   │   ├── admin.js            # /stats and interactive /addstock wizard
│   │   └── customer.js         # /start, GB vs IP, brand/variation navigation, /myorders, /help
│   ├── keyboards.js            # Type, brand, variation, and checkout inline keyboards
│   └── index.js                # Telegraf bot initialization & polling launcher
├── server/
│   ├── middleware/auth.js      # JWT authentication for admin REST API
│   ├── routes/
│   │   ├── api.js              # Admin REST endpoints (Stats, ipdokan Sync, Stock, Orders)
│   │   └── webhook.js          # SSLCommerz IPN receiver (+ legacy WooCommerce webhook)
│   ├── db.js                   # MongoDB connection manager
│   └── index.js                # Express app setup and HTTP server
├── models/
│   ├── Brand.js                # Proxy vendor schema
│   ├── Plan.js                 # Quota and pricing package schema
│   ├── Stock.js                # Proxy credentials repository schema
│   ├── Order.js                # Order and transaction audit schema (with wooOrderId)
│   ├── User.js                 # Customer analytics schema
│   └── Admin.js                # Admin dashboard user schema
├── services/
│   ├── ipdokan.js              # ipdokan.com catalog client + Brand/Plan sync
│   ├── woocommerce.js          # Legacy WooCommerce client (old orders only)
│   ├── payment.js              # SSLCommerz session creation & validation
│   ├── stockService.js         # Atomic FIFO allocation & bulk import engine
│   └── notifyAdmin.js          # Telegram admin alerts for sales & empty stock
├── admin-panel/                # React (Vite) + Tailwind CSS dashboard
│   ├── src/
│   │   ├── components/Sidebar.jsx
│   │   ├── pages/Dashboard.jsx
│   │   ├── pages/Products.jsx
│   │   ├── pages/Stock.jsx
│   │   ├── pages/Orders.jsx
│   │   ├── pages/Login.jsx
│   │   ├── api.js
│   │   └── App.jsx
│   └── vite.config.js
├── scripts/
│   └── seed.js                 # Seeds admin account & syncs products from ipdokan.com
├── .env.example
├── package.json
└── README.md
```

---

## ⚙️ Configuration & Environment Variables

All settings are stored in `.env`:

```ini
# Telegram Bot
BOT_TOKEN=your_telegram_bot_token
ADMIN_IDS=123456789              # Your Telegram numeric ID (get from @userinfobot)
SUPPORT_CONTACT=@ipdokan

# Server & Database
PORT=5001
APP_BASE_URL=http://localhost:5001
MONGODB_URI=mongodb+srv://<user>:<password>@<cluster>/telegram_proxy_store

# ipdokan.com catalog
IPDOKAN_URL=https://ipdokan.com

# ZiniPay (payment; Dashboard → Brands → Brand Key)
ZINIPAY_API_KEY=
ZINIPAY_REDIRECT_URL=

# SSLCommerz (used when ZiniPay isn't configured)
GATEWAY_SANDBOX=true
GATEWAY_STORE_ID=your_store_id
GATEWAY_STORE_PASSWORD=your_store_password

# Legacy WooCommerce (only used to cancel old orders)
WOOCOMMERCE_URL=https://ipdokan.com
WOOCOMMERCE_CONSUMER_KEY=ck_your_read_write_consumer_key
WOOCOMMERCE_CONSUMER_SECRET=cs_your_consumer_secret
WOOCOMMERCE_WEBHOOK_SECRET=generate_a_long_random_webhook_secret

# Admin Dashboard
JWT_SECRET=generate_a_long_random_jwt_secret
ADMIN_PANEL_USERNAME=your_admin_username
ADMIN_PANEL_PASSWORD=use_a_strong_password
```

---

## 🛠 Setup & Running

### 1. Seed Database & Sync ipdokan.com Products

```bash
npm run seed
```

This will:

1. Verify/create the default admin credentials (`admin` / `admin123`).
2. Connect to `ipdokan.com` and automatically populate all GB and IP products and variations with live pricing.

### 2. Start Backend & Bot Concurrently

```bash
npm run dev
```

- Express server runs on `http://localhost:5001`.
- Telegram bot starts in polling mode with token `8562022376:...`.

### 3. Launch React Admin Panel

In a second terminal:

```bash
cd admin-panel
npm run dev
```

Open `http://localhost:3000` and log in with:

- **Username:** `admin`
- **Password:** `admin123`

---

## 📡 Payment & Delivery (ZiniPay, Cryptomus, or SSLCommerz)

After **Confirm Order** the customer picks a payment method (bKash / Nagad via ZiniPay in ৳, or crypto via
Cryptomus in $ at ipdokan.com's USD price). The invoice is created only for the chosen method, and the order is
then locked to it, so it can't be paid twice.

**Service fee:** like ipdokan.com's checkout, every order adds a service fee (`fee = round(subtotal × p%)`,
`total = subtotal + fee`, for both ৳ and $). The rate is read from ipdokan.com (`/api/payments/mode`, 5% today);
set `SERVICE_FEE_PERCENT` to override it. The quantity screen and the Mini App show subtotal, fee and total.

**ZiniPay** (used when `ZINIPAY_API_KEY` is set):
1. Copy the Brand Key from ZiniPay → Brands into `ZINIPAY_API_KEY`.
2. Set `APP_BASE_URL` to the bot server's public https address. Each invoice tells ZiniPay to call
   `<APP_BASE_URL>/webhook/zinipay` after payment.
3. ZiniPay only accepts a `redirect_url` on the brand's website domain. If the bot runs on a different
   domain, set `ZINIPAY_REDIRECT_URL` / `ZINIPAY_CANCEL_URL` to pages on that site (e.g. `https://ipdokan.com/`).
4. ZiniPay webhooks aren't signed, so the bot never trusts them: it calls ZiniPay's verify API, and delivers
   only when the invoice is `COMPLETED` for the full amount. Pending ZiniPay orders from the last 24h are also
   re-checked every minute, so a missed webhook still gets delivered.

**Cryptomus** (shown when `CRYPTOMUS_MERCHANT_ID` and `CRYPTOMUS_PAYMENT_KEY` are set): requests are signed
(md5 of base64 JSON + payment key); the webhook `<APP_BASE_URL>/webhook/cryptomus` is signature-checked, and the
invoice is always re-read from Cryptomus (`paid` / `paid_over`, full USD amount) before delivery. Pending
Cryptomus orders are re-checked every minute too.

**SSLCommerz** (fallback when ZiniPay isn't set up): set `GATEWAY_STORE_ID`, `GATEWAY_STORE_PASSWORD`, `GATEWAY_SANDBOX`; the IPN is
`<APP_BASE_URL>/webhook/payment-ipn`.

**Delivery** (both): upload credentials in **Admin → Stock** for each package (choose a location for
location-based packages). A paid order gets its credentials in the Telegram chat instantly. If the pool is
empty the order becomes `stock_pending`, the customer is told, and the admin is alerted to deliver manually.

---

## 🧪 Local Testing with ngrok

1. Expose port 5001: `ngrok http 5001`
2. Set `APP_BASE_URL` to the forwarding URL (e.g. `https://abc1234.ngrok-free.app`) and restart.
3. Send `/start` to the bot, pick a product, package and location, and pay in the SSLCommerz sandbox.

---

## 📜 Available Scripts

| Command                           | Description                                       |
| --------------------------------- | ------------------------------------------------- |
| `npm run dev`                     | Runs Express server & Telegram bot in watch mode  |
| `npm run dev:server`              | Starts Express server on port 5001                |
| `npm run dev:bot`                 | Starts Telegram bot in polling mode               |
| `npm run seed`                    | Syncs all products from ipdokan.com into database |
| `cd admin-panel && npm run dev`   | Runs Vite React development server on port 3000   |
| `cd admin-panel && npm run build` | Builds production assets for admin panel          |
