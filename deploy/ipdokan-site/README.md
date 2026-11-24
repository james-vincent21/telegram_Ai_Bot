# ipdokan.com bot bridge

`bot.routes.js` lives in the website backend at `/var/www/ipdokan/backend/routes/bot.routes.js`
and is mounted in `backend/app.js` right after `app.use(express.json(...))`:

```js
import botRoutes from "./routes/bot.routes.js";
app.use("/api/bot", botRoutes);
```

It lets the Telegram bot create / pay / cancel orders in the website's own store, so bot sales
reserve and sell the website's codes (and supplier proxies) like a normal checkout.

- Website `.env`: `BOT_API_SECRET=<32+ random chars>`
- Bot `.env`: `SITE_BOT_SECRET=<same value>`, `SITE_API_URL=http://127.0.0.1:4000/api/bot`
- Only direct local requests with the secret are accepted; anything via nginx is refused.
