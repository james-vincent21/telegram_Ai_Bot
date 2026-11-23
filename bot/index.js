require('dotenv').config();
const { Telegraf } = require('telegraf');
const mongoose = require('mongoose');
const { registerCustomerHandlers, registerFallbackHandler } = require('./handlers/customer');
const { registerAdminHandlers } = require('./handlers/admin');
const { registerToolHandlers } = require('./handlers/tools');
const { registerTicketHandlers, registerTicketTextHandler } = require('./handlers/tickets');
const { startReminderScheduler } = require('./reminders');
const keyboards = require('./keyboards');
const notifyAdminService = require('../services/notifyAdmin');

const token = process.env.BOT_TOKEN;
if (!token) {
  console.error('FATAL: BOT_TOKEN is missing in environment variables.');
}

const bot = new Telegraf(token || 'DUMMY_TOKEN');

// Wire up bot instance to admin alert service
notifyAdminService.setBotInstance(bot);

// Logging middleware for incoming updates
bot.use((ctx, next) => {
  const user = ctx.from ? `@${ctx.from.username || ctx.from.id} (${ctx.from.first_name || ''})` : 'Unknown';
  const content = ctx.message?.text || ctx.callbackQuery?.data || `[${ctx.updateType}]`;
  console.log(`📩 [Telegram Bot Update] ${user}: ${content}`);
  return next();
});

// Global Telegraf error boundary
bot.catch((err, ctx) => {
  console.error(`[Telegraf Error] for update ${ctx?.updateType}:`, err);
});

// Register bot modules
registerCustomerHandlers(bot);
registerToolHandlers(bot);
registerTicketHandlers(bot);
registerAdminHandlers(bot);
registerTicketTextHandler(bot); // after admin text wizard, before fallback
registerFallbackHandler(bot); // must stay last

async function launchBot() {
  // Connect to MongoDB if not already connected
  if (mongoose.connection.readyState === 0) {
    const mongoUri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/telegram_proxy_store';
    try {
      await mongoose.connect(mongoUri);
      console.log('✅ [MongoDB] Connected successfully (Bot)');
    } catch (err) {
      console.error('❌ [MongoDB] Connection error:', err.message);
      process.exit(1);
    }
  }

  try {
    const botInfo = await bot.telegram.getMe();
    console.log(`🤖 [Telegram Bot] Authorized as @${botInfo.username} (${botInfo.id})`);

    // Command list shown in Telegram's "Menu" button and when typing "/"
    try {
      await bot.telegram.setMyCommands([
        { command: 'start', description: '🏠 Home & main menu' },
        { command: 'buy', description: '⚡ Buy a proxy' },
        { command: 'myorders', description: '🧾 My orders & credentials' },
        { command: 'ticket', description: '🎫 Open a support ticket' },
        { command: 'tickets', description: '📂 My support tickets' },
        { command: 'support', description: '💬 Help & support' },
      ]);
      // Menu button opens the Mini App shop when an https SHOP_URL is set
      const shop = keyboards.shopUrl();
      await bot.telegram.setChatMenuButton({
        menuButton: shop
          ? { type: 'web_app', text: 'Shop', web_app: { url: shop } }
          : { type: 'commands' },
      });
    } catch (err) {
      console.warn('⚠️ [Telegram Bot] Could not set command menu:', err.message);
    }

    // In local development, launch via Long Polling
    bot.launch({
      dropPendingUpdates: true,
    });
    console.log('🚀 [Telegram Bot] Polling started successfully!');
    startReminderScheduler(bot.telegram);
  } catch (err) {
    console.error('❌ [Telegram Bot] Failed to start bot:', err.message);
  }

  // Graceful shutdown
  process.once('SIGINT', () => bot.stop('SIGINT'));
  process.once('SIGTERM', () => bot.stop('SIGTERM'));
}

// If invoked directly from terminal (e.g. npm run bot)
if (require.main === module) {
  launchBot();
}

module.exports = {
  bot,
  launchBot,
};
