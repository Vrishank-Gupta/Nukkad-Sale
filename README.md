# NukkadSale

**NukkadSale** (nukkad, नुक्कड़: the street-corner shop) is a flash-sale checkout and *khata* (ledger) for WhatsApp community sellers. Live at [nukkadsale.in](https://nukkadsale.in).

The product was first called Khatakhat, and khatakhat.co.in now redirects to nukkadsale.in. Internal names still use `khatakhat`: the Worker, the D1 database, the R2 bucket and the encryption salt. Leave them as they are.

A seller posts a product in a minute and pastes the link into their WhatsApp groups. Buyers grab a piece and pay by UPI. Stock locks live, so nothing is oversold, and every sale lands in the khata automatically.

- 📣 **30-second promo to send to sellers (vertical, WhatsApp-ready, with sound):** [`docs/nukkadsale-promo.mp4`](docs/nukkadsale-promo.mp4)
- 🎬 **Full product showcase – small sellers, buyers, running the shop, big sellers:** [`docs/nukkadsale-showcase.mp4`](docs/nukkadsale-showcase.mp4)
- 📘 **Architecture, database, integrations, costs and deployment plan:** [`docs/PLATFORM-GUIDE.md`](docs/PLATFORM-GUIDE.md)

## Buyers order inside WhatsApp

Buyers don't use websites, so they don't have to:
1. The group message carries an order link that shows the product photo card.
2. Tapping it opens a WhatsApp chat with "Order #abc1234" ready. The buyer taps send.
3. The NukkadSale bot shows the photo, price and size buttons, then asks for the address (remembered next time) and sends the payment button.
4. Confirmation and shipping updates come back in the same chat.

**No UTR is ever needed.** The unique amount (₹798.52) identifies the buyer, and buyers can tap "I have paid" or just send their payment screenshot. The seller sees the screenshot with a reminder that screenshots can be faked.

Meta doesn't charge for these replies, because the buyer starts the chat. The website checkout stays as a fallback.

## Fits how WhatsApp sellers already sell

- **Several products, one payment.** A buyer who taps a second product's link while still paying gets it added to the same order: one total with unique paise, one "I have paid", and one card for the seller to confirm and pack. This works in the WhatsApp chat and on the website, whenever the items pay into the same UPI ID.
- **Questions go to the seller.** Every product in the bot shows "💬 Questions? Message {shop}", and a typed question like "Do you have Musk Kashmir?" gets the seller's own WhatsApp link.
- **Share with photo.** One tap sends the sale's photos and caption together to WhatsApp through the phone's share sheet, exactly like a normal community post. Photos can also be downloaded for WhatsApp Web.
- **Quick order from a chat.** Buyer DMed the seller as usual? The seller picks the products, and NukkadSale makes a ready WhatsApp message with the exact total and a pay link. Stock is held for 30 minutes. If the address is missing, the buyer fills it in on the payment page.

## Two ways to get paid (you decide per seller in the admin portal)

| | Option 1: Manual check | Option 2: Automatic (payment gateway) |
|---|---|---|
| Best for | Small sellers, up to about 20 orders a day | Busy sellers |
| How | Buyer pays the seller's UPI ID. Each order gets a unique amount (₹798.**52**), so the seller sees "Did you get ₹798.52?" and taps **Yes** | **Razorpay**, on the seller's own account. Confirms itself within about a minute. |
| Fee | **₹0** | The gateway's fee: standard is about 2%, and UPI is often 0% during offers |
| Setup | Just a UPI ID | Paste the Razorpay Key ID and secret into Settings. No webhook needed. |

## Admin portal and monthly fees

The admin portal is separate from seller accounts. Open `/admin/login`. The first time, use **Set up your admin PIN** with your number (it must be in `ADMIN_PHONES`) and the one-time `ADMIN_SETUP_CODE`. Sellers never see an admin link.
- **Per seller:**
  - switch payment methods on or off (Manual UPI / Razorpay); big sellers can be locked to a gateway with no manual confirmation
  - enter gateway keys on the seller's behalf
  - set a monthly fee and free trial
  - suspend or re-activate
- **Billing:**
  - an invoice is created automatically every month
  - sellers pay through your Razorpay account (confirmed automatically) or by UPI (you confirm with one tap)
  - reminders on WhatsApp
  - overdue sellers can't start new sales, while their buyers are never affected
- **Dashboard:** sellers, active sellers, monthly fees (MRR), collected, unpaid, and sales through the platform.

## Running cost: about ₹0

Cloudflare Workers, D1 (database), R2 (photos) and cron all fit in the free tier. WhatsApp messages go out free through tap-to-send `wa.me` buttons; automatic messages through Meta's Cloud API are optional. Details and sources are in the guide.

## Built for first-time smartphone users, sellers and buyers alike

- **English and हिंदी** on every screen, switchable with one tap from the first page.
- **🔊 Listen:** every main screen can read its instructions aloud, using the phone's own free voice.
- **Soundbox habit:** the dashboard says "New order" and vibrates, like the payment soundboxes shopkeepers already use.
- **Home is a to-do list:** "2 payments to check", "5 orders to send". Below it, the week at a glance: a sales chart, orders, average order and money waiting.
- **Several UPI IDs** (shop, personal…): pick one per sale. **Up to 5 photos per sale**, swipeable for buyers. Buyers never see stock counts – only “Available”, “🔥 Selling fast” or “Sold out”.
- **Your buyers:** a customer list ranked by spend, with repeat buyers, one-tap WhatsApp and a contacts export for broadcast lists. **Sell again** relaunches a past sale in one tap.
- **Payment checks are a yes/no question:** "Did you get ₹798.52?"
- **Khatabook-style khata:** green **You got ₹** and red **You gave ₹**.
- **Big touch targets** (at least 44 px), +/− steppers instead of typing, and product photos on every order.
- **Buyers:**
  - a sticky **Buy now** bar
  - details remembered, so the next checkout is one tap ("Delivering to … · Change")
  - a separate pincode field
  - a nudge to tap "I have paid" when they come back from their UPI app
  - the order status remembered on their phone
  - Paid → Packed → Sent → Delivered tracking

## Works on Android and iPhone

- **UPI payments:** Android gets one **Pay** button, which opens the phone's own UPI app chooser. iPhone has no chooser, so it gets **GPay / PhonePe / Paytm / other** buttons, one per app. Every phone also gets **Copy UPI ID** and **Copy amount** as a fallback. Computers get the QR code.
- **No zoom on iOS:** no text box is smaller than 16 px, so iOS Safari doesn't zoom in on tap. Safe-area padding handles notched phones.
- **Installable** from Chrome or Safari ("Add to Home Screen"), using a web manifest and Apple touch icon.
- **Native share sheet** on both platforms, alongside the WhatsApp share.
- **Tested** with Playwright on Pixel 7, iPhone 13 and iPhone SE profiles, at 320 px, and on desktop: no sideways scrolling, no small text boxes or tap targets, and the right Pay buttons on each platform. The iPhone profile runs in Chromium; a true Safari run still needs a real iPhone.

## Run it locally

Node 22+ is needed (v26 LTS is installed on this machine).

```bash
npm install
cp .dev.vars.example .dev.vars        # then set SECRET_KEY to a long random string
npm run db:migrate:local
npm run dev                           # http://localhost:8787
```

## Deploy (about 10 minutes, free Cloudflare account)

```bash
npx wrangler login
npx wrangler d1 create khatakhat      # paste the printed database_id into wrangler.jsonc
npx wrangler r2 bucket create khatakhat-images
npm run db:migrate:remote
npx wrangler secret put SECRET_KEY    # long random string, keep it safe
npm run deploy
```

> ⚠️ Never change `SECRET_KEY` after launch. It peppers PIN hashes and encrypts the gateway keys.

Optional secrets:
- `ADMIN_PHONES` and `ADMIN_SETUP_CODE`: who can be admin, and the one-time code needed to create an admin PIN at `/admin/setup`.
- `SUPPORT_PHONE`: adds the WhatsApp help button.
- `WA_TOKEN`, `WA_PHONE_ID`, `WA_APP_SECRET`, `WA_VERIFY_TOKEN`, `WA_BOT_NUMBER`: the WhatsApp ordering bot.
- `WA_ORDER_TEMPLATE`, `WA_OTP_TEMPLATE`: templates for messages outside the 24-hour window.

The guide covers staging, the go-live checklist and rollback.

## Project layout

```
migrations/0001_init.sql      schema
src/index.tsx                 routing, cron, landing, PWA manifest/icons
src/routes/public.tsx         buyer pages: sale, checkout, order status
src/routes/seller.tsx         seller dashboard: home, sales, orders, khata, settings, help
src/routes/auth.tsx           signup, login (phone + PIN), PIN reset
src/routes/webhooks.ts        Razorpay (optional) and WhatsApp webhooks
src/routes/admin.tsx          admin portal: sellers, payment methods, fees, billing
src/lib/wa-bot.ts             WhatsApp ordering bot
src/lib/billing.ts            monthly invoices and platform settings
src/lib/notify.ts             updates back into the buyer's WhatsApp chat
src/lib/orders.ts             stock holds and markPaid (the core logic)
src/lib/gateway.ts            Razorpay payments, confirmation and reconciliation
src/lib/{razorpay,upi,whatsapp,mail}.ts   integrations
src/i18n.ts                   every on-screen string, English and Hindi
src/views/layout.tsx          layout, CSS, shared components
docs/                         platform guide, promo and showcase videos
tests/e2e/                    browser, bot and admin end-to-end tests, plus the video scripts
```
