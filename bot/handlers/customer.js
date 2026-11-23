const Order = require("../../models/Order");
const User = require("../../models/User");
const strings = require("../config/strings");
const keyboards = require("../keyboards");
const animator = require("../stepAnimator");
const woocommerce = require("../../services/woocommerce");

const MAX_QUANTITY = 50;

/**
 * Registers or updates user activity in database
 */
async function trackUser(from) {
  try {
    await User.findOneAndUpdate(
      { telegramId: from.id },
      {
        $set: {
          username: from.username || "",
          firstName: from.first_name || "",
          lastActiveAt: new Date(),
        },
        $setOnInsert: {
          firstSeenAt: new Date(),
          totalOrders: 0,
          totalSpent: 0,
        },
      },
      { upsert: true, new: true },
    );
  } catch (err) {
    console.error("[TrackUser] Error recording user:", err.message);
  }
}

/**
 * Register all customer bot handlers
 * @param {import('telegraf').Telegraf} bot
 */
function registerCustomerHandlers(bot) {
  // Any button tap stops that message's step animation before the handler edits it
  bot.on("callback_query", animator.stopOnTap);

  // /start command
  async function sendWelcome(ctx) {
    await trackUser(ctx.from);
    await ctx.reply(strings.welcome(ctx.from.first_name), {
      parse_mode: "HTML",
      ...keyboards.mainMenuKeyboard(),
    });
    await ctx.reply(strings.quickStart, {
      parse_mode: "HTML",
      ...keyboards.welcomeKeyboard(),
    });
  }

  bot.start(sendWelcome);
  bot.hears([strings.mainMenuButton, ...strings.legacyButtons.mainMenu], sendWelcome);

  // Inline "Home": turn the current message back into the quick-start card
  bot.action("go_home", async (ctx) => {
    await ctx.answerCbQuery();
    try {
      return await ctx.editMessageText(strings.quickStart, {
        parse_mode: "HTML",
        ...keyboards.welcomeKeyboard(),
      });
    } catch (err) {
      if (!/message is not modified/i.test(err.message)) throw err;
    }
  });

  // Exit: close the current menu message
  bot.action("nav_exit", async (ctx) => {
    await ctx.answerCbQuery("👋 Closed");
    try {
      await ctx.deleteMessage();
    } catch {
      // Older than 48h or already gone: replace it with a short goodbye instead
      await ctx.editMessageText(strings.exitMessage, { parse_mode: "HTML" }).catch(() => {});
    }
  });

  // Quick actions that open a NEW message (used under delivery messages,
  // so the credentials are never overwritten)
  bot.action("new_buy", async (ctx) => {
    await ctx.answerCbQuery("Loading categories...");
    return showAllCategories(ctx);
  });
  bot.action("open_orders", async (ctx) => {
    await ctx.answerCbQuery();
    return showMyOrders(ctx);
  });
  bot.action("open_support", async (ctx) => {
    await ctx.answerCbQuery();
    return showSupport(ctx);
  });

  // Step 1: User taps "Buy Proxy" or /buy -> Fetch & display ALL categories from WooCommerce
  bot.hears([strings.buyProxyButton, ...strings.legacyButtons.buyProxy], showAllCategories);
  bot.command("buy", showAllCategories);

  async function showAllCategories(ctx) {
    await trackUser(ctx.from);
    ctx.sendChatAction("typing").catch(() => {});
    try {
      const categories = await woocommerce.getCategories();
      if (!categories || categories.length === 0) {
        return ctx.reply(strings.loadError("categories", "No categories were found."), {
          parse_mode: "HTML",
          ...keyboards.retryKeyboard("new_buy"),
        });
      }
      return animator.reply(ctx, strings.selectCategory, keyboards.categoriesKeyboard(categories));
    } catch (err) {
      console.error("[Bot Categories Error]:", err.message);
      return ctx.reply(strings.loadError("categories"), {
        parse_mode: "HTML",
        ...keyboards.retryKeyboard("new_buy"),
      });
    }
  }

  // Handle "Back to Categories" or "Refresh Categories"
  bot.action(["back_to_cats", "refresh_categories"], async (ctx) => {
    await ctx.answerCbQuery("Loading categories...");
    try {
      const force = ctx.match === "refresh_categories";
      const categories = await woocommerce.getCategories(force);
      return await animator.edit(ctx, strings.selectCategory, keyboards.categoriesKeyboard(categories));
    } catch (err) {
      if (/message is not modified/i.test(err.message)) return;
      return ctx.editMessageText(strings.loadError("categories"), {
        parse_mode: "HTML",
        ...keyboards.retryKeyboard("refresh_categories"),
      });
    }
  });

  // Step 2: User clicks a Category: cat_<categoryId> -> Fetch & display Products under that Category
  bot.action(/^cat_(\d+)$/, async (ctx) => {
    await ctx.answerCbQuery("Loading products...");
    const categoryId = ctx.match[1];

    try {
      const [categories, products] = await Promise.all([
        woocommerce.getCategories(),
        woocommerce.getProductsByCategory(categoryId),
      ]);

      const currentCat = categories.find(
        (c) => String(c.id) === String(categoryId),
      );
      const catName = currentCat
        ? `${currentCat.emoji} ${currentCat.name}`
        : "Category";

      if (!products || products.length === 0) {
        return ctx.editMessageText(
          `📭 <b>${catName}</b>\n\nThere are no products here right now. Please check another category.`,
          {
            parse_mode: "HTML",
            ...keyboards.productsKeyboard([], categoryId),
          },
        );
      }

      return await animator.edit(ctx, strings.selectProduct(catName), keyboards.productsKeyboard(products, categoryId));
    } catch (err) {
      console.error("[Bot Category Products Error]:", err.message);
      return ctx.editMessageText(strings.loadError("products"), {
        parse_mode: "HTML",
        ...keyboards.retryKeyboard(`cat_${categoryId}`),
      });
    }
  });

  // Step 3: User clicks a Product: prod_<productId>_<categoryId> -> Show Variations / Packages
  bot.action(/^prod_(\d+)_(\d+)$/, async (ctx) => {
    await ctx.answerCbQuery("Loading packages...");
    const productId = ctx.match[1];
    const categoryId = ctx.match[2];

    try {
      const [product, variations] = await Promise.all([
        woocommerce.getProduct(productId),
        woocommerce.getProductVariations(productId),
      ]);

      if (!variations || variations.length === 0) {
        // Simple product or no variations -> ask for quantity
        return await showQuantity(ctx, productId, 0, 1, { product }, categoryId);
      }

      return await animator.edit(
        ctx,
        strings.selectPlan(product.name),
        keyboards.variationsKeyboard(variations, productId, categoryId),
      );
    } catch (err) {
      console.error("[Bot Product Details Error]:", err.message);
      return ctx.editMessageText(strings.loadError("packages"), {
        parse_mode: "HTML",
        ...keyboards.retryKeyboard(`prod_${productId}_${categoryId}`),
      });
    }
  });

  // Step 4: Out of stock click
  bot.action(/^outofstock_(\d+)$/, async (ctx) => {
    await ctx.answerCbQuery("😔 This package is sold out right now. Please pick another one.", {
      show_alert: true,
    });
  });

  // Resolves product + selected package (variationId 0 = simple product)
  async function resolveItem(productId, variationId, prefetched = {}) {
    const product = prefetched.product || (await woocommerce.getProduct(productId));
    if (!variationId) {
      return {
        product,
        name: "Standard",
        price: parseFloat(product.price) || 0,
        inStock: product.stock_status === "instock",
        stockQuantity: product.stock_quantity ?? null,
      };
    }
    const variations = await woocommerce.getProductVariations(productId);
    const selectedVar = variations.find(
      (v) => String(v.id) === String(variationId),
    );
    if (!selectedVar) return null;
    return {
      product,
      name: selectedVar.name,
      price: parseFloat(selectedVar.price) || 0,
      inStock: selectedVar.inStock,
      stockQuantity: selectedVar.stockQuantity ?? null,
    };
  }

  function maxQuantity(item) {
    return item.stockQuantity > 0
      ? Math.min(MAX_QUANTITY, item.stockQuantity)
      : MAX_QUANTITY;
  }

  // Step 5: show the quantity selector for a package
  // Where "Back" goes from the quantity / sold-out screens
  function backFrom(productId, variationId, categoryId) {
    if (!categoryId || categoryId === "0") return "back_to_cats";
    return variationId && variationId !== "0" ? `prod_${productId}_${categoryId}` : `cat_${categoryId}`;
  }

  async function showQuantity(ctx, productId, variationId, quantity, prefetched, categoryId = 0) {
    const item = await resolveItem(productId, variationId, prefetched);
    const back = backFrom(productId, String(variationId || 0), String(categoryId || 0));
    if (!item) {
      return ctx.editMessageText("😕 <b>This package could not be found.</b>\n\nPlease pick another one.", {
        parse_mode: "HTML",
        ...keyboards.navKeyboard(back),
      });
    }
    if (!item.inStock) {
      return ctx.editMessageText(strings.outOfStockAlert, {
        parse_mode: "HTML",
        ...keyboards.navKeyboard(back),
      });
    }
    const max = maxQuantity(item);
    const qty = Math.min(max, Math.max(1, quantity));
    return animator.edit(
      ctx,
      strings.selectQuantity(item.product.name, item.name, item.price, qty, "BDT"),
      keyboards.quantityKeyboard(
        productId,
        variationId,
        qty,
        max,
        `${Math.round(item.price * qty * 100) / 100} BDT`,
        categoryId,
      ),
    );
  }

  // User picks a Variation / Package: var_<productId>_<variationId>[_<categoryId>]
  // (the categoryId part is optional so buttons from older messages keep working)
  bot.action(/^var_(\d+)_(\d+)(?:_(\d+))?$/, async (ctx) => {
    await ctx.answerCbQuery();
    const categoryId = ctx.match[3] || 0;
    try {
      return await showQuantity(ctx, ctx.match[1], ctx.match[2], 1, undefined, categoryId);
    } catch (err) {
      console.error("[Quantity Error]:", err.message);
      return ctx.editMessageText(strings.loadError("the package"), {
        parse_mode: "HTML",
        ...keyboards.retryKeyboard(ctx.match[0]),
      });
    }
  });

  // Quantity stepper: qty_<productId>_<variationId>_<qty>[_<categoryId>]
  bot.action(/^qty_(\d+)_(\d+)_(\d+)(?:_(\d+))?$/, async (ctx) => {
    await ctx.answerCbQuery();
    try {
      return await showQuantity(
        ctx,
        ctx.match[1],
        ctx.match[2],
        parseInt(ctx.match[3], 10),
        undefined,
        ctx.match[4] || 0,
      );
    } catch (err) {
      // Telegram rejects edits that change nothing (e.g. tapping the counter)
      if (!/message is not modified/i.test(err.message)) {
        console.error("[Quantity Error]:", err.message);
      }
    }
  });

  // Confirm: buy_<productId>_<variationId>_<qty>[_<categoryId>] -> create order + payment link
  bot.action(/^buy_(\d+)_(\d+)_(\d+)(?:_(\d+))?$/, async (ctx) => {
    await ctx.answerCbQuery("Generating payment link...");
    const productId = ctx.match[1];
    const variationId = ctx.match[2] === "0" ? null : ctx.match[2];
    const back = backFrom(productId, ctx.match[2], ctx.match[4] || "0");

    try {
      const item = await resolveItem(productId, variationId);
      if (!item) {
        return ctx.editMessageText("😕 <b>This package could not be found.</b>\n\nPlease pick another one.", {
          parse_mode: "HTML",
          ...keyboards.navKeyboard(back),
        });
      }
      if (!item.inStock) {
        return ctx.editMessageText(strings.outOfStockAlert, {
          parse_mode: "HTML",
          ...keyboards.navKeyboard(back),
        });
      }

      const quantity = Math.min(
        maxQuantity(item),
        Math.max(1, parseInt(ctx.match[3], 10)),
      );
      const { product } = item;
      const timestamp = Date.now().toString().slice(-6);
      const randomSuffix = Math.floor(1000 + Math.random() * 9000);
      const orderId = `ORD-${timestamp}-${randomSuffix}`;
      const total = Math.round(item.price * quantity * 100) / 100;

      // Create Order in WooCommerce
      const wooResult = await woocommerce.createOrder({
        telegramId: ctx.from.id,
        telegramUsername: ctx.from.username || "",
        firstName: ctx.from.first_name || "",
        productId,
        variationId,
        quantity,
        note: `Order from Telegram: @${ctx.from.username || ctx.from.id}`,
      });

      // Save order in local MongoDB
      await Order.create({
        orderId,
        wooOrderId: String(wooResult.id),
        wooProductId: parseInt(productId, 10),
        wooVariationId: variationId ? parseInt(variationId, 10) : null,
        productName: product.name,
        variationName: item.name,
        proxyType: product.name.toUpperCase().includes("GB") ? "gb" : "ip",
        telegramId: ctx.from.id,
        telegramUsername: ctx.from.username || "",
        telegramFirstName: ctx.from.first_name || "",
        quantity,
        unitPrice: item.price,
        amount: total,
        currency: "BDT",
        gatewayRedirectUrl: wooResult.paymentUrl,
        status: "pending",
      });

      return await animator.edit(
        ctx,
        strings.orderSummary(product.name, item.name, total, "BDT", orderId, quantity),
        keyboards.orderPaymentKeyboard(wooResult.paymentUrl, orderId, total, "BDT"),
      );
    } catch (err) {
      console.error("[OrderCreation Error]:", err.message);
      return ctx.editMessageText(strings.orderCreateError, {
        parse_mode: "HTML",
        ...keyboards.retryKeyboard(ctx.match[0]),
      });
    }
  });

  // Handle Cancel Order callback: cancel_order_<orderId>
  bot.action(/^cancel_order_(.+)$/, async (ctx) => {
    const orderId = ctx.match[1];
    try {
      const cancelled = await cancelPendingOrder(orderId, ctx.from.id);
      if (!cancelled) {
        await ctx.answerCbQuery(strings.orderCancelUnavailable, {
          show_alert: true,
        });
        return;
      }
      await ctx.answerCbQuery("Order cancelled");
      return ctx.editMessageText(strings.orderCancelled, { parse_mode: "HTML" });
    } catch (err) {
      console.error("[Cancel Order]", err.message);
      return ctx.answerCbQuery("Unable to cancel the order. Please try again.", {
        show_alert: true,
      });
    }
  });

  // /myorders command or reply button
  bot.hears([strings.myOrdersButton, ...strings.legacyButtons.myOrders], showMyOrders);
  bot.command("myorders", showMyOrders);

  async function showMyOrders(ctx) {
    await trackUser(ctx.from);
    ctx.sendChatAction("typing").catch(() => {});
    const view = await getOrdersView(ctx.from.id);
    return ctx.reply(view.text, {
      parse_mode: "HTML",
      ...keyboards.userOrdersKeyboard(view.pendingCount),
    });
  }

  bot.action("user_refresh_orders", async (ctx) => {
    await ctx.answerCbQuery("Refreshing orders...");
    const view = await getOrdersView(ctx.from.id);
    try {
      return await ctx.editMessageText(view.text, {
        parse_mode: "HTML",
        ...keyboards.userOrdersKeyboard(view.pendingCount),
      });
    } catch (err) {
      // Nothing changed since the last refresh
      if (!/message is not modified/i.test(err.message)) throw err;
    }
  });

  // Cancels the WooCommerce orders too, so unpaid carts do not remain active
  // on the website. Paid orders are intentionally never removable by a user.
  bot.action("user_clear_pending", async (ctx) => {
    try {
      const pendingOrders = await Order.find({
        telegramId: ctx.from.id,
        status: "pending",
      });
      if (!pendingOrders.length) {
        await ctx.answerCbQuery(strings.noPendingOrders, { show_alert: true });
        return;
      }

      const results = await Promise.allSettled(
        pendingOrders.map((order) => cancelPendingOrder(order.orderId, ctx.from.id)),
      );
      const cancelledCount = results.filter(
        (result) => result.status === "fulfilled" && result.value,
      ).length;

      await ctx.answerCbQuery(
        cancelledCount
          ? `${cancelledCount} order${cancelledCount === 1 ? " has" : "s have"} been cancelled`
          : "No orders could be cancelled",
        { show_alert: true },
      );
      const view = await getOrdersView(ctx.from.id);
      return ctx.editMessageText(
        cancelledCount ? `${strings.userOrdersCleared(cancelledCount)}\n\n${view.text}` : view.text,
        {
          parse_mode: "HTML",
          ...keyboards.userOrdersKeyboard(view.pendingCount),
        },
      );
    } catch (err) {
      console.error("[Clear Pending Orders]", err.message);
      return ctx.answerCbQuery("Unable to clear the cart. Please try again.", {
        show_alert: true,
      });
    }
  });

  async function getOrdersView(telegramId) {
    const orders = await Order.find({ telegramId })
      .sort({ createdAt: -1 })
      .limit(10);
    const pendingCount = await Order.countDocuments({
      telegramId,
      status: "pending",
    });

    if (orders.length === 0) {
      return { text: strings.noOrders, pendingCount };
    }

    let text = strings.myOrdersHeader;
    for (const ord of orders) {
      text += "\n" + strings.orderItem(
        ord,
        ord.productName || "Proxy",
        ord.variationName || "Package",
      );
    }
    return { text, pendingCount };
  }

  async function cancelPendingOrder(orderId, telegramId) {
    const order = await Order.findOne({ orderId, telegramId, status: "pending" });
    if (!order) return false;

    // Cancel website-side first. This prevents a stale payment URL from being used.
    if (order.wooOrderId && !order.wooOrderId.startsWith("DIRECT-")) {
      await woocommerce.cancelOrder(order.wooOrderId);
    }

    // Conditional update prevents overwriting a payment webhook that arrived meanwhile.
    const updated = await Order.findOneAndUpdate(
      { _id: order._id, status: "pending" },
      { $set: { status: "cancelled" } },
      { new: true },
    );
    return Boolean(updated);
  }

  // /help or /support command or reply button
  bot.hears([strings.supportButton, ...strings.legacyButtons.support], showSupport);
  bot.command("help", showSupport);
  bot.command("support", showSupport);

  async function showSupport(ctx) {
    await trackUser(ctx.from);
    const supportContact = process.env.SUPPORT_CONTACT || "@ipdokan";
    return ctx.reply(strings.support(supportContact), {
      parse_mode: "HTML",
      link_preview_options: { is_disabled: true },
      ...keyboards.supportKeyboard(supportContact),
    });
  }
}

/**
 * Friendly reply for messages the bot doesn't understand.
 * Register this LAST, after every other handler.
 */
function registerFallbackHandler(bot) {
  bot.on("text", async (ctx) => {
    await ctx.reply(strings.unknownMessage(ctx.from.first_name), {
      parse_mode: "HTML",
      ...keyboards.welcomeKeyboard(),
    });
  });
}

module.exports = {
  registerCustomerHandlers,
  registerFallbackHandler,
};
