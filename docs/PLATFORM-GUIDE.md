# Khatakhat: Platform Guide

How the platform is built: architecture, database, integrations (payments and WhatsApp), costs, and the plan for taking it live.

> 🎬 [`docs/khatakhat-promo.mp4`](khatakhat-promo.mp4): a 47-second vertical promo to send to sellers.
> 🎬 [`docs/khatakhat-showcase.mp4`](khatakhat-showcase.mp4): the full product showcase (3:48) – small sellers, buyers, running the shop, big sellers.

---

## 1. What it is

Khatakhat (खटाखट, Hindi for "quick") lets WhatsApp community sellers run flash sales:

1. The seller adds a product (photo, price, pieces, sizes) and gets a ready-made WhatsApp message with an order link.
2. **Buyers order inside WhatsApp** (§6). They tap the link, send the pre-filled message, and the Khatakhat bot handles size, address and payment in the chat. Buyers who prefer it can use the website checkout instead.
3. Stock is locked the moment a buyer taps **Pay**, so the last piece can only be sold once.
4. Payment is confirmed in one of two ways, chosen per seller (see §5):
   - **Option 1, manual check (free):** the seller taps "Yes, I got it".
   - **Option 2, automatic:** Razorpay confirms the payment.
5. Every paid order is written into the seller's **khata** (ledger). The buyer is notified, and the seller works through a simple to-do list: confirm, pack, send.

The whole interface works in **English and Hindi** and is built for cheap Android phones on slow networks.

**Three kinds of user:**
- **Buyers** live in WhatsApp, so they never need an app, an account or a UTR.
- **Sellers** get a to-do-list dashboard, a weekly business overview, a customer list and a khata.
- **The platform admin** (you) decides which payment methods each seller may use and collects a monthly fee from each seller (§13).

---

## 2. Architecture

```
            WhatsApp group                              Seller's phone (browser)
                 │  link                                      │
                 ▼                                            ▼
        ┌──────────────────────────────────────────────────────────────────┐
        │           Cloudflare Worker  (Hono, server-rendered HTML)        │
        │                                                                  │
        │  /d/:id  buyer sale page     /app/*  seller dashboard            │
        │  /o/:id  buyer order page    /login /signup /reset               │
        │  /webhooks/razorpay/:seller (optional)  /webhooks/whatsapp       │
        │  cron every 2 min: reconcile gateway payments, release holds     │
        └───────┬───────────────┬────────────────┬──────────────┬──────────┘
                │               │                │              │
          ┌─────▼─────┐   ┌─────▼─────┐   ┌──────▼──────┐  ┌────▼─────────────┐
          │ D1 (SQL)  │   │ R2 images │   │ Razorpay    │  │ Meta WhatsApp    │
          │ sellers,  │   │ product   │   │ Payment     │  │ Cloud API        │
          │ drops,    │   │ photos    │   │ Links (opt.,│  │ (optional)       │
          │ orders,   │   │           │   │ per seller) │  │                  │
          │ ledger …  │   └───────────┘   └─────────────┘  └──────────────────┘
          └───────────┘
```

**Design choices**

- **One Worker, no separate frontend.** Pages are rendered on the server as plain HTML forms, with about 3 KB of inline JavaScript for extras: copy, live stock polling, countdown, photo compression and steppers. Everything still works if JavaScript fails, and pages load fast on 3G.
- **No frameworks, no web fonts, no CSS library.** One inline stylesheet supports light and dark mode.
- **Each seller uses their own UPI ID or gateway account.** The money never passes through the platform, so the platform doesn't need a payment-aggregator licence and carries no settlement liability.

**Code map**

| Path | What's in it |
|---|---|
| `src/index.tsx` | Routing, security headers, landing page, cron handler |
| `src/routes/public.tsx` | Buyer pages (sale, checkout, order status, UTR), image serving, language switch |
| `src/routes/seller.tsx` | Seller dashboard: home, new sale, sale detail, orders, khata, settings, help |
| `src/routes/auth.tsx` | Signup, login (phone + PIN), PIN reset over WhatsApp |
| `src/routes/webhooks.ts` | Razorpay (optional) and WhatsApp webhooks |
| `src/routes/admin.tsx` | Admin portal: dashboard, sellers, payment methods per seller, billing, platform settings |
| `src/lib/wa-bot.ts` | WhatsApp ordering bot (conversation flow) |
| `src/lib/notify.ts` | Messages back to the buyer's chat: payment received, rejected, shipping |
| `src/lib/billing.ts` | Monthly invoices, fee payments, platform settings, admin checks |
| `src/lib/orders.ts` | **Core logic:** stock holds, `markPaid`, expiry, reject, UTR |
| `src/lib/gateway.ts` | Starting Razorpay payments, confirmation and reconciliation |
| `src/lib/razorpay.ts`, `upi.ts`, `whatsapp.ts`, `mail.ts` | Integrations |
| `src/lib/auth.ts`, `crypto.ts`, `util.ts` | Sessions, PIN hashing, AES-GCM, money/phone helpers |
| `src/i18n.ts` | Every on-screen string in English and Hindi |
| `src/views/layout.tsx` | Shared layout, CSS, UI components |
| `migrations/0001_init.sql` | Database schema |

---

## 3. Database (Cloudflare D1, which is SQLite)

All money is stored as **integer paise**, and all times as **epoch milliseconds**. Dates shown to users are converted to IST.

| Table | Purpose | Key columns |
|---|---|---|
| `sellers` | One row per shop | `phone` (unique, `91XXXXXXXXXX`), `pin_hash` + `pin_salt`, `upi_vpa`, `pay_mode` (`direct` / `razorpay`), encrypted gateway keys |
| `sessions` | Login sessions (60 days) | `token_hash` (SHA-256 of the cookie token), `expires_at` |
| `pin_resets` | WhatsApp one-time codes | `code_hash`, `attempts`, `expires_at` |
| `drops` | A flash sale ("Sale" in the UI) | `price_paise`, `image_key`, `max_per_order`, `status` (`live` / `closed`) |
| `variants` | Sizes/options; every drop has at least one | `stock` (listed), **`available`** (not held, not sold), `CHECK (available >= 0)` |
| `orders` | One per checkout | `status`, `ship_status`, `amount_paise`, `utr`, `gateway_ref`, `pay_url`, `hold_until`, `gw_checked_at` |
| `seller_upis` | Several UPI IDs per seller, each with a label. `sellers.upi_vpa` is the default; `drops.upi_vpa` picks one per sale. | `vpa`, `label` |
| `drop_images` | Up to 5 photos per sale. `drops.image_key` is the cover. | `image_key`, `position` |
| `admins`, `admin_sessions` | Platform admins, separate from sellers | `phone`, PIN hash, sessions |
| `ledger` | The khata | `kind` (`credit` / `debit`), `amount_paise`, `note`, **`UNIQUE(order_id, kind)`** |
| `webhook_events` | Webhook and WhatsApp message replay protection | event id (`wa:<message id>` for WhatsApp) |
| `buyers` | WhatsApp buyers, remembered by number | `name` (from their WhatsApp profile), `address`, `pincode`, `lang`, `last_inbound_at` (Meta's 24-hour window) |
| `wa_sessions` | Where each buyer is in the ordering chat | `state` (size / qty / address / confirm_address / pay), `drop_id`, `variant_id`, `qty`, `order_id` |
| `invoices` | Monthly platform fee per seller | `period` (YYYY-MM), `amount_paise` (fee + unique paise), `status` (due / claimed / paid / waived), `due_at`, `gateway_ref` |
| `platform_settings` | Admin settings | fee-collection UPI ID and Razorpay keys, default fee, trial, grace days, default payment methods |

Columns that support these features:
- `sellers.allowed_modes`, `plan_fee_paise`, `trial_until` and `account_status` are set by the admin.
- `orders.channel` (`web` / `whatsapp`) records where the order came from.
- `orders.proof_key` points to the buyer's payment screenshot, which is private and only a hint.

### Several items, one payment (carts)

Each item stays its own order row, with its own stock hold and its own sale. Rows paid together share `cart_id`, which is the first row's id.
- **Joining:** a new item joins an open cart when it's the same buyer, same seller, the cart is still pending, has the same payment mode and pays into the same UPI ID. The whole cart's hold is extended, and any old gateway link is dropped because the total changed.
- **Amount:** the payable amount is the sum of the rows. For direct UPI the unique paise are re-picked per cart, so they sit on the first row. Uniqueness is checked across all open *payments*, whether single orders or carts.
- **Actions:** confirm, reject, cancel, "I have paid", ship and notifications always apply to the whole cart (`markCartPaid`, `rejectCart`, `claimCart`, `cancelCart`). The buyer gets one message listing every item.
- **Gateways:** a gateway link covers the cart total, and confirmation checks the amount paid against that total.
- **Quick orders** (`orders.assisted = 1`) are created by the seller from a chat. They skip the per-buyer and per-device limits, hold stock for 30 minutes, and may leave the address empty for the buyer to fill in on `/o/:id`.

### How overselling is prevented

- **Holding stock.** When a buyer taps Pay, one statement runs: `UPDATE variants SET available = available - :qty WHERE id = :v AND available >= :qty`. D1 runs single statements atomically, and the `CHECK (available >= 0)` rule is a second safety net. In testing, 10 buyers raced for 3 pieces and exactly 3 succeeded.
- **Releasing holds.** A cron job every 2 minutes puts expired holds back in stock. Stock and order status are updated in one transaction, so they can't drift apart. The same release also runs right away whenever a buyer hits "out of stock".
- **Hold length.** 10 minutes for direct UPI. 16 minutes for gateways, because gateway links must stay open at least 15 minutes.

### Order statuses

```
           buyer taps Pay
                 │
                 ▼
            ┌─────────┐  hold lapses (cron)   ┌─────────┐
            │ pending │──────────────────────▶│ expired │──┐ late payment, stock still free
            └────┬────┘                       └─────────┘  │
   direct: buyer │ "I have paid"                           │
                 ▼                                         │
           ┌───────────┐  seller: "No"   ┌──────────┐      │
           │ verifying │────────────────▶│ rejected │      │
           └─────┬─────┘                 └──────────┘      │
 seller "Yes" /  │  gateway confirms (Option 2)            │
                 ▼                                         │
             ┌──────┐◀───────────────────────────────────────┘
             │ paid │──▶ ship_status: new → packed → shipped → delivered
             └──────┘
  late payment with no stock left ──▶ refund_due  (shown to the seller as a task)
```

**Every route to "paid" goes through one function, `markPaid()`.** This covers the seller tap, the gateway redirect, the webhook, the order-page poll and the cron job.

- It is idempotent, and the ledger's unique key means **an order can never be credited twice**.
- In testing, webhook and redirect arrived at the same moment, and the seller double-tapped; each case produced exactly one khata entry.

### Backups

D1 Time Travel lets you restore the database to any minute in the last 30 days (7 on the free plan):

```
wrangler d1 time-travel restore khatakhat --timestamp=<unix>
```

For an off-site copy, run `wrangler d1 export khatakhat --remote --output backup.sql` on a schedule.

---

## 4. File storage (Cloudflare R2)

- Product photos are **shrunk on the seller's phone** before upload (to at most 1080 px, JPEG quality 0.82). A 6 MB camera photo becomes about 150 KB.
- They're stored in R2 under unique keys and served from `/img/*` with `Cache-Control: immutable`, so Cloudflare's edge caches them.
- JPEG keeps WhatsApp link previews working. The `og:image` tag points at the product photo, so pasting the link in a group shows a rich card.
- R2 charges **nothing for egress (downloads)**.

---

## 5. Payments: two options sellers choose between

Sellers pick in **Settings → How you get paid** and can switch at any time. Orders already placed keep the mode they started with.

### Option 1: Manual check (free), for low-volume sellers

**How it works**

1. The order gets a **unique amount**: the price plus 1–99 paise that no other open order of that seller has. For example, ₹799 becomes ₹799.48.
2. The buyer pays, and the right buttons appear for their device:
   - **Android:** one **Pay** button with `upi://pay?pa=<seller VPA>&am=799.48&tn=<order no>`. The phone shows its own UPI app chooser.
   - **iPhone:** iOS has no chooser, and `upi://` opens whichever app claimed it last, or nothing. So there's one button per app: GPay (`gpay://upi/pay`), PhonePe (`phonepe://pay`), Paytm (`paytmmp://pay`), and BHIM/other (`upi://`).
   - **Any phone:** **Copy UPI ID** and **Copy amount** as a fallback.
   - **Computer:** the QR code is open by default.
   - When the buyer comes back from their UPI app, the page scrolls to **"I have paid"** and highlights it.
3. The buyer taps **"I have paid"**, or sends their payment screenshot, which is the habit they already have. **No UTR or reference number is ever asked for**, because most buyers can't find one.
4. The seller sees **"Did you get ₹799.48 in your UPI app?"** with Yes / No buttons. If the buyer sent a screenshot, it appears with a warning that screenshots can be faked. The unique paise let the seller match the payment in their UPI app at a glance.
5. **"Waiting for money":** buyers often pay without telling anyone, so the Check payment tab also lists every open amount, including holds that lapsed in the last 24 hours. Those amounts stay reserved for a day, so a late payment can't be confused with a new order. Tapping Yes on a lapsed order takes the piece back if it's still in stock, or flags a refund.

**Cost:** ₹0. P2M UPI below ₹2,000 carries no MDR (merchant discount rate, the bank fee merchants pay on each payment). Small merchants stay at zero MDR up to ₹1 lakh/month in receipts. ([Insights on India](https://www.insightsonindia.com/2026/09/16/upi-merchant-discount-rate-mdr-framework-2026/), [FintechSpecs](https://fintechspecs.com/blog/india-upi-mdr-october-15-2026-merchant-fee-explained/))

**Recommend a free business UPI** (PhonePe Business, Paytm for Business, BharatPe). These give instant sound alerts and avoid the limits some apps place on personal VPAs that receive many payments.

**Limits:** someone has to tap "Yes" for each order, which works up to roughly 20 orders a day. Bigger sellers should use Option 2, which the admin can enforce (§13).

### Option 2: Automatic (Razorpay), for busy sellers

The seller connects **their own** Razorpay account. Payments confirm themselves within about a minute, with no checking. Razorpay is the only gateway; money goes straight into the seller's account.

| | |
|---|---|
| API | Payment Links: `POST /v1/payment_links`, `GET /v1/payment_links/{id}` (basic auth with the seller's Key ID + Key secret) |
| Seller setup | Sign up at razorpay.com, finish KYC, then Account & Settings → API Keys (Live mode) → Generate key. Paste the **Key ID + Key secret** into Settings → How you get paid, or the admin pastes them on the seller's page. **No webhook needed.** |
| Webhook | Optional (`/webhooks/razorpay/:seller`, signed with a secret the seller chooses). Not required, because every path asks Razorpay directly. |

**How a payment is confirmed (defence in depth)**

1. When the buyer taps Pay, we create one Payment Link for the order (or the whole cart), expiring with the hold, and redirect the buyer to it.
2. The order is confirmed through **independent paths**:
   - the buyer's redirect back to `/o/:id/paid` (its signature is verified when present)
   - the order page polling every 6 s (which asks Razorpay at most every 15 s)
   - the cron job every 2 minutes, which re-checks recent unpaid orders
   - the optional webhook
3. **We never trust the redirect alone.** Every path calls `GET /v1/payment_links/{id}` with the seller's keys. The order is marked paid only if `amount_paid ≥` the order (or cart) total.

**Tested** against a local Razorpay mock (`tests/e2e/mock_razorpay.py`, signed and unsigned redirects): the happy path, a redirect without signature (confirmed by asking the API), carts paid with one link, and the "missing keys" validation.

**Not yet tested** against Razorpay's live API. Do one ₹10 live payment per new big seller (go-live doc, Step 10).

#### Fees (check before launch; rates change often)

| | Standard rate on the provider's own pages | Notes |
|---|---|---|
| Option 1 (direct UPI) | **0%** | P2M MDR is zero up to ₹2,000; small merchants stay zero up to ₹1 lakh/month |
| Razorpay | About 2%, which also applies to UPI | Charged by Razorpay to the seller ([comparison](https://claudecms.com/news/india-ecommerce-payment-processing-fees-compared/)) |

**New from 15 Oct 2026:** reports say a 0.4% MDR (capped at ₹300) applies to UPI merchant payments above ₹2,000. Payments of ₹2,000 or less stay at zero. Ask each gateway how it passes this through. ([PayU](https://payu.in/blog/upi-mdr-2026-what-the-new-charge-means-for-businesses/), [FintechSpecs](https://fintechspecs.com/blog/india-upi-mdr-october-15-2026-merchant-fee-explained/))

**Guidance for sellers** (also in the in-app Help): under about 20 orders a day, use Option 1. Above that, the 1–2% fee buys back hours of checking, so use Option 2.

---

## 6. WhatsApp

### 6a. Ordering inside WhatsApp (the bot)

Buyers are used to WhatsApp, not websites, so the whole purchase can happen in a chat with one platform WhatsApp Business number. Each message shows the seller's shop name.

```
Group message: "👉 Tap to order on WhatsApp: khtk.in/w/abc1234"
   │  (WhatsApp shows the product photo card – /w/ serves Open Graph tags,
   │   then redirects the tap to wa.me/<bot>?text=Order #abc1234 – <title>)
   ▼
Buyer taps Send  →  bot: photo + price + stock + size buttons (or a list for >3 sizes)
                 →  quantity buttons (only if more than 1 allowed)
                 →  "Send it to this address? [✅ Yes, here] [✏️ New address]"   (saved buyers)
                    or "Type your full address with pincode"                     (first time)
                 →  stock held · "Pay ₹799.48" button + UPI ID to copy
                    + [✅ I have paid] [❌ Cancel]  – or the buyer just sends a screenshot
Seller taps Yes  →  bot: "✅ Payment received! Order #… Updates will come here."
Seller ships     →  bot: "📦 Order #…: Packed / Sent / Delivered"
"status"         →  bot lists the buyer's recent orders
```

**Details:**
- The buyer's name and number come from WhatsApp, so the only thing a buyer ever types is their address, once.
- The bot replies in Hindi if the buyer writes in Hindi.
- WhatsApp buttons can only open `https` links, so the Pay button opens the buyer's order page. That page opens their UPI app, with per-app buttons on iPhone, and has a **Back to WhatsApp** button.
- For Option 2 sellers, the Pay button goes straight to the gateway and confirms itself.

**Cost:** every bot message is a reply inside Meta's 24-hour customer-service window, which the buyer opens by messaging first. Meta doesn't charge for these, and utility templates sent inside the window are free as well. Check the current rate card before launch. Shipping updates more than 24 hours after the buyer's last message are skipped unless a template is configured; the seller's free 💬 button still works.

**Security:**
- Every webhook's `X-Hub-Signature-256` is verified with the app secret.
- Each message id is processed once, because Meta retries.
- Replies are sent after the webhook returns, so Meta never times out.

**Setup (one platform number):**
1. In Meta for Developers, create an app and add the WhatsApp product. Register the number.
2. Webhook URL: `https://<your-domain>/webhooks/whatsapp`. The verify token is your `WA_VERIFY_TOKEN`. Subscribe to `messages`.
3. Set these secrets:
   - `WA_TOKEN` (permanent system-user token)
   - `WA_PHONE_ID`
   - `WA_APP_SECRET`
   - `WA_VERIFY_TOKEN`
   - `WA_BOT_NUMBER` (the bot's number, `91XXXXXXXXXX`)
4. Once all of these are set, share messages switch to the WhatsApp order link automatically. Without them, the website checkout is used.

### 6b. Messages from the seller

| Mode | How | Cost |
|---|---|---|
| **Default (free)** | `wa.me` click-to-chat buttons with pre-written messages: share the sale to groups, remind a buyer, confirm payment, shipping updates, refund note. The seller taps, and WhatsApp opens with the text ready. | ₹0 |
| **Automatic (optional)** | Meta WhatsApp Cloud API. A **utility** template is sent when an order is paid. An **authentication** template (copy-code button) is used for PIN resets. | Meta's per-message rate. Check the current India rate card. |

**Setup for automatic messages**
1. Create a WhatsApp Business app in Meta Business Manager. You get a phone number ID and a permanent token.
2. Get these templates approved:
   - Order confirmation (utility, 5 variables): `Hi {{1}}, your order for {{2}} ({{3}}) from {{4}} is confirmed ✅ Order no. {{5}}`
   - PIN reset (authentication): Meta's standard OTP template with a copy-code button
3. Set the secrets `WA_TOKEN`, `WA_PHONE_ID`, `WA_ORDER_TEMPLATE` and `WA_OTP_TEMPLATE`. The UI switches over automatically. For example, "Forgot PIN?" appears only when the OTP template exists.

The platform sends automatic messages from **one platform number**, on behalf of all shops.

---

## 7. Background jobs

One cron trigger, `*/2 * * * *` (free on Workers), runs in this order:

1. `reconcileGateways`: re-checks up to 25 recent unpaid Razorpay orders, at most once a minute each. It runs **first**, so a paid order is never released back to stock.
2. `expireHolds`: releases lapsed holds.
3. `billingCron`: creates this month's fee invoices, and re-checks online fee payments whose webhook may have been lost.
4. Cleanup: deletes expired sessions and webhook ids older than 30 days.

---

## 8. Security

| Area | Measure |
|---|---|
| Seller login | Phone + 4–6 digit PIN, with PBKDF2 hashing (per-user salt plus a server pepper, `SECRET_KEY`). 5 wrong tries lock the account for 15 minutes. |
| Sessions | Random token in an HttpOnly, Secure, SameSite=Lax cookie. Only the SHA-256 of the token is stored. |
| CSRF | Origin check on every non-GET request, plus SameSite cookies |
| Gateway keys | AES-GCM encrypted at rest with a key derived from `SECRET_KEY`, and never shown again after saving |
| Webhooks | Signature verified. Razorpay status is always re-fetched from its API. Webhook ids are kept to prevent replays. |
| Buyer order pages | 14-character random ids, so they can't be guessed |
| Abuse | One open hold per buyer phone per sale, and at most 3 unpaid holds per device/network per sale |
| Headers | `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy: same-origin` |

⚠️ **`SECRET_KEY` must never change after launch.** Changing it locks out every seller (their PIN hashes no longer match) and makes saved gateway keys unreadable.

---

## 9. Deployment plan

### Environments

| Env | URL | Data | Payments |
|---|---|---|---|
| Local | `localhost:8787` (`npm run dev`) | Local D1/R2 under `.wrangler/` | Mock or sandbox |
| Staging | `khatakhat-staging.<account>.workers.dev` | Separate D1 + R2 | Razorpay **test-mode** keys |
| Production | `khatakhat.<account>.workers.dev`, or your domain | Production D1 + R2 | Live keys (each seller's own) |

Staging is already configured in `wrangler.jsonc` under `env.staging`, with its own D1 database, R2 bucket and secrets, and is deployed at **https://khatakhat-staging.vrishankgupta.workers.dev**. Redeploy with `npx wrangler deploy --env staging`.

### Step by step (first launch)

```bash
# 0. Tools: Node 22+ is installed (v26 LTS on this machine), then:
npm install

# 1. Cloudflare resources (free account)
npx wrangler login
npx wrangler d1 create khatakhat            # copy database_id into wrangler.jsonc
npx wrangler r2 bucket create khatakhat-images

# 2. Schema
npm run db:migrate:remote

# 3. Secrets
npx wrangler secret put SECRET_KEY          # 32+ random bytes, store in a password manager
npx wrangler secret put SUPPORT_PHONE       # optional, 91XXXXXXXXXX
npx wrangler secret put ADMIN_PHONES        # your number(s), 91XXXXXXXXXX – opens /admin after you sign up
# WhatsApp ordering bot: WA_TOKEN, WA_PHONE_ID, WA_APP_SECRET, WA_VERIFY_TOKEN, WA_BOT_NUMBER
# optional templates: WA_ORDER_TEMPLATE, WA_OTP_TEMPLATE

# 4. Ship
npm run deploy
```

**Custom domain (optional, about ₹800/yr):** add the domain to Cloudflare and attach it to the Worker under Workers → Settings → Domains & Routes. A short domain such as `khtk.in/d/abc` looks more trustworthy in WhatsApp groups.

### Go-live checklist

- [ ] Staging run with **Razorpay test-mode keys**: confirm the redirect returns to `/o/:id/paid` and the order shows Paid without anyone tapping
- [ ] UPI intent tested on real Android phones with GPay, PhonePe and Paytm, using a **business VPA**
- [ ] WhatsApp link preview checked: paste a sale link in a group and confirm the photo card shows
- [ ] WhatsApp templates approved, if automatic messages are on
- [ ] `SECRET_KEY` backed up. D1 Time Travel noted. Weekly `d1 export` scheduled.
- [ ] Cloudflare email alerts on Worker errors. `wrangler tail` for live logs during the first sales.
- [ ] Privacy note and terms page: buyer addresses and phone numbers are personal data under the DPDP Act

### Rollout

1. **Pilot:** 5–10 friendly sellers (a boutique, a home baker, an organic store) on Option 1. Watch two or three real flash sales live.
2. **Option 2 beta:** move the 1–2 busiest pilots to Razorpay.
3. **Open sign-ups.**

### Rollback

`wrangler rollback` restores the previous Worker version in seconds. The schema only ever grows (new migrations add columns or tables and never drop them), so a rollback is always safe.

### Scaling and running cost

| | Free tier | When you outgrow it |
|---|---|---|
| Workers | 100k requests/day, 10 ms CPU each | Workers Paid **$5/month**: 10M requests, 30 s CPU |
| D1 | 5 GB, 5M rows read and 100k rows written per day | Included in Workers Paid, with much higher limits |
| R2 | 10 GB, 1M writes and 10M reads per month, **free egress** | $0.015/GB-month |
| Cron | Included | Included |

A busy flash sale (50 pieces, 300 buyers) uses only a few thousand requests, so **hundreds of active sellers fit in the free tier**. The first real cost is likely the $5 plan, which arrives long before revenue becomes a question.

*Cloudflare limits are from memory. Check the current pricing pages.*

---

## 10. What was tested

**Tested locally:**
- signup and login, including the lockout after 5 wrong PINs
- creating sales, with and without sizes and photos
- the 10-buyer race for 3 pieces: no oversell
- unique paise amounts
- UTR flow, both optional and invalid
- seller Yes and No
- hold expiry and late reclaim
- refund-due flag
- stock edits that can't go below what's sold
- cross-origin POST blocked
- Razorpay: signed and unsigned redirects, webhook signed, forged and replayed
- khata, including the CSV export
- Hindi on every screen
- a full browser walkthrough on a phone viewport (the video)
- the cross-platform and buyer-journey checks in §11
- the WhatsApp bot against a Meta API mock, 28 checks (`tests/e2e/wa_bot_test.py`): webhook handshake and signatures, the full chat order, pincode validation, unique amount, "I have paid", screenshot as proof (private and viewable by the seller), confirmation and shipping messages back in the chat, saved-address repeat order, Hindi, cancel puts stock back, the status command
- the admin portal and billing, 24 checks (`tests/e2e/admin_billing_test.py`): admin-only access; platform defaults applied at signup; sellers limited to the methods you switched on; forced gateway with no manual buttons; invoice paid online (auto-confirmed) and by UPI (admin confirms); overdue pauses only new sales; suspension stops orders

**Not yet tested** (needs real accounts):
- Razorpay's live API
- Meta Cloud API message delivery: the bot is tested against a mock, so do a real-number test in Meta's sandbox before launch
- UPI intent and the iPhone per-app links on physical phones
- Safari/WebKit rendering

---

## 11. UX principles and device support

**Who it's for:** first-time smartphone users who live in WhatsApp, both sellers and buyers.

**Research behind it:**
- Low-literacy mobile UI research done in India: graphical cues, voice, local language, large radio buttons, linear flows, and human help one tap away. ([Medhi et al., Microsoft Research](https://www.microsoft.com/en-us/research/wp-content/uploads/2016/02/ToCHI2711_Medhi.pdf), [Chaudry](https://course.ccs.neu.edu/is4300f13/ssl/chaudry.pdf), [CSCW 2021 guidelines](https://anupriyatuli.github.io/publications/2021_CSCW.pdf))
- Habits users already have from apps they know (see below).

**Seller side**

| Principle | Where it shows up |
|---|---|
| Local language | English/हिंदी on the very first screen, and everywhere after. Detected from the phone's language, remembered for a year. |
| Voice | A 🔊 button reads the instructions for each main screen aloud, using the phone's own text-to-speech (free, `hi-IN` / `en-IN`). |
| Familiar habits | Soundbox-style spoken "New order" with a vibration. Khatabook-style green **You got ₹** and red **You gave ₹**. WhatsApp-green share buttons. |
| Tasks, not menus | Home shows "N payments to check / N orders to send / N paying now". Orders open on the first tab that has work in it. |
| Questions, not jargon | "Did you get ₹799.48 in your UPI app?" → ✓ Yes / ✗ No. Status chips have icons (⏳ 🔎 ✅ ↩️). |
| Pictures | A product photo on every order card. Numbered steps when creating a sale. A big photo picker. |
| No typing where avoidable | +/− steppers, size presets (S M L XL, 28–36, 250g/500g/1kg), remembered buyer details |
| Human help | ❓ in the header goes to a simple FAQ, plus a "Chat with us on WhatsApp" button (`SUPPORT_PHONE`) |
| Safe actions | Confirmation only for actions that are hard to undo. A toast after every action ("✅ Marked as paid and added to your khata"). |

**Buyer side**
- a sticky **Buy now** bar with price and stock
- a live total on the Pay button
- size pills that show "2 left" per size
- a separate numeric pincode field
- a one-tap repeat checkout ("Delivering to … · Change")
- a countdown while the piece is held
- the nudge back to "I have paid"
- the order remembered on the phone ("You have an order here")
- Paid → Packed → Sent → Delivered tracking
- "Try again" when time runs out
- "Ask the seller" and "Share with a friend" buttons

**Android and iPhone**
- The platform-specific UPI buttons described in §5.
- Every text box is at least 16 px, so iOS Safari doesn't zoom in on tap.
- `env(safe-area-inset-*)` padding for notched phones.
- No dependence on `:has()` for anything functional, so older Android Chrome works.
- `navigator.vibrate` and `speechSynthesis` are feature-checked, because iOS lacks vibration and speech needs a first tap.
- Installable as a home-screen app via `manifest.webmanifest` and `apple-touch-icon`.
- The native share sheet is offered next to WhatsApp share.

**Automated checks** (Playwright, run on the Pixel 7, iPhone 13, iPhone SE at 320 px and desktop profiles):
- no sideways scrolling on any buyer or seller page
- no text box under 16 px
- no tap target under 40 px
- the right Pay buttons on each platform
- QR open only on desktop
- manifest and icons served correctly
- a separate buyer-journey test covering the sticky bar, pincode validation, the return nudge, the repeat-checkout summary and the order banner

The iPhone profile runs in Chromium. A real Safari/WebKit run needs a physical iPhone or a machine with Playwright's WebKit libraries installed.

## 12. Seller overview and customers

**Buyers never see stock numbers.** The buyer page, the WhatsApp bot, the share message and the public stock feed (`/d/:id/stock.json`) only say *Available*, *🔥 Selling fast* (when about a fifth or less is left) or *Sold out*. The quantity picker isn't capped by stock either, since that would reveal the count; the server refuses an order if not enough is left. Sellers still see everything.

Besides the to-do list, Home has two more sections:
- **This week:** total sales, a 7-day bar chart (IST days), number of orders, average order, and money still waiting to be confirmed.
- **Your buyers:** a link to the customer list.

**Your buyers** (`/app/buyers`) lists everyone who paid, ranked by spend, with order count, last order date and a *Repeat* tag. Each buyer has a one-tap WhatsApp button with a "New collection is live" message. A contacts CSV export lets the seller import numbers into a WhatsApp broadcast list.

**Sell again** (on every sale page) opens a new sale pre-filled with the photo, details, price, sizes and stock, because repeat drops are the norm for these sellers.

## 13. Admin portal and monthly fees

**Access:** the admin portal is separate from seller accounts. It has its own login at `/admin/login`, its own 6-digit PIN (5 wrong tries lock it for 15 minutes), and its own session cookie, scoped to `/admin`. It is never linked from the seller app.
- To create an admin PIN at `/admin/setup`, the phone must be in `ADMIN_PHONES` **and** you must enter the one-time `ADMIN_SETUP_CODE`, so knowing your number isn't enough.
- Removing a number from `ADMIN_PHONES` revokes that admin's access immediately.
- When a seller asks for automatic payments (at signup, or with the Request button in Settings), the dashboard shows "🙋 N sellers want automatic payments".

| Page | What you can do |
|---|---|
| Dashboard | Sellers, active in the last 30 days, monthly fees (MRR), collected this month, unpaid invoices, sales through the platform. Shortcuts to "sellers who say they paid" and "overdue". |
| Sellers | Search. Each seller shows billing status (Free / Trial / Due / Overdue / Paid up), switched-on payment methods, and 30-day orders and sales. |
| Seller detail | **Payment methods:** switch Manual UPI / Razorpay on or off and choose the active one. The Razorpay key fields appear under Razorpay when it's ticked, so you can enter the keys yourself for non-technical sellers. A gateway can't be activated until its keys exist. If only one method is on, the seller sees it as "Set by Khatakhat". **Monthly fee and free-trial end date**, with "create invoice now". **Invoices:** mark paid, waive, or send a WhatsApp reminder with the pay link. **Suspend / re-activate.** |
| Billing | All invoices: Unpaid / Says paid / Overdue / Paid / All, with the same actions |
| Settings | Your UPI ID and Razorpay keys for collecting fees. Defaults for new sellers: fee, trial days, days to pay, payment methods. |

**How fee collection works:**
- **Invoices:** the cron job creates one invoice per seller per IST month, once the trial has ended. Each gets a unique amount, such as ₹299.37, so a plain UPI payment can be matched.
- **Paying online:** on `/app/billing`, sellers pay through **your** Razorpay account. This is confirmed automatically by the return check and the cron re-check.
- **Paying by UPI:** sellers can also pay your UPI ID (per-app buttons on iPhone) and tap "I have paid", which shows up as **Says paid** for you to confirm.
- **Missed payments:** after the due date, new sales pause, with a "Pay now" banner everywhere. Existing sales keep taking orders, so buyers are never hurt. Suspension stops all of that seller's orders.

**Big sellers, no manual confirmation:** switch on Razorpay only. The seller then never sees a "Yes, I got it" button; gateway orders show "Paying online – confirms by itself".

*Possible next step:* UPI AutoPay mandates (Razorpay Subscriptions) to collect the monthly fee with no action from the seller each month.

## 14. Roadmap ideas

- **PhonePe PG** as a third Option 2 gateway
- **Auto-matching for Option 1:** parse UPI SMS alerts forwarded from the seller's phone, so even free mode confirms by itself
- A **shop page** listing all of a seller's live sales, and a **"notify me"** list for sold-out items
- A **courier integration** (Shiprocket, Delhivery) behind "Mark as sent"
- **Turnstile** (free bot check) on checkout if bots start holding stock
- An installable **PWA** home-screen icon with push notifications for new orders
