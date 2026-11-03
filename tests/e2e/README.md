# End-to-end checks and the product video

These scripts drive the real app in a headless browser. Start the app first (`npm run dev`, on a fresh local database), then:

```bash
npm i -D playwright && npx playwright install chromium

OUT=/tmp/kk MODE=shots node tests/e2e/tour.mjs            # full seller + buyer walkthrough, screenshots
node tests/e2e/platforms.mjs <dropId> /tmp/kk              # Android / iPhone / 320px / desktop checks
node tests/e2e/buyer.mjs <dropId> /tmp/kk                  # buyer journey: sticky bar, pincode, nudge, repeat checkout
```

**Against staging or production:** prefix any browser script with `BASE=https://khatakhat-staging.vrishankgupta.workers.dev`. On the live site every test buyer shares your real IP, so the "3 unpaid orders per device" limit applies; skip `platforms.mjs` there (layout is identical to local). Clean up the test seller afterwards.

`tour.mjs` signs up the demo seller (phone 9876543210, PIN 4321), so run it against an empty database. `platforms.mjs` and `buyer.mjs` reuse the sale it creates, so add stock first if it has sold out.

**WhatsApp bot and admin/billing** (API-level, Python standard library only). Start the mocks and the app with test settings:

```bash
python3 tests/e2e/mock_meta.py &                 # stands in for Meta's Graph API on :8791
python3 tests/e2e/mock_razorpay.py signed &      # stands in for Razorpay on :8792
npx wrangler dev --local-upstream localhost:8787 --upstream-protocol http --var OPEN_SIGNUP:1 --var ALLOW_TEST_KEYS:1 --var ADMIN_PHONES:919999999999 --var WA_TOKEN:test-token --var WA_PHONE_ID:1234 \
  --var WA_APP_SECRET:app-secret --var WA_VERIFY_TOKEN:verify-me --var WA_BOT_NUMBER:919000000000 \
  --var WA_API_BASE:http://localhost:8791 --var RAZORPAY_API_BASE:http://localhost:8792/v1

python3 tests/e2e/wa_bot_test.py         # 28 checks; empty database
python3 tests/e2e/admin_billing_test.py  # admin login, payment methods, billing; empty database
python3 tests/e2e/features_test.py       # several UPI IDs, per-sale UPI, 5 photos, sell again
python3 tests/e2e/plans_test.py          # plans: 30-order limit, block, upgrade, admin undo/activate (OPEN_SIGNUP + admin vars; KK_PERSIST if --persist-to)
node tests/e2e/pwa.mjs <base-url> /tmp/x  # installable app: manifest, service worker, offline, install card
```
(Start the app with `--var ADMIN_SETUP_CODE:setup-code` for the admin test. Against staging, set `BASE=…` for the Python tests too.)
```
```

**Promo video** (`docs/nukkadsale-promo.mp4`): reel 10 in `social/reels.html` (same engine and soundtrack as the reels). Render it with `cd tests/e2e/social && node render.mjs 10 && python3 audio.py 10`, then copy `out/reel-10.mp4`. The older `promo/promo.html` showed the WhatsApp-bot chat and is kept only for reference.

**Razorpay without real keys:** run `python3 tests/e2e/mock_razorpay.py signed` (or `unsigned`, to test that payments are still confirmed by asking the API when the return carries no signature). Then start the app with `--var RAZORPAY_API_BASE:http://localhost:8792/v1`.

`icons.mjs src/icons.ts` regenerates the home-screen app icons.

**Full showcase video** (`docs/nukkadsale-showcase.mp4`):

- **How it's recorded:** `showcase/showcase.mjs` records the real app on a phone screen. The app's own screens are never changed during recording.
- **The WhatsApp chat:** the script chats with the **real bot** through the signed webhook, captures exactly what the bot sends back (through `mock_meta.py`), and `chat-template.html` plays those messages back. The screen is labelled "Chat re-created from the bot's real messages".
- **The gateway checkout:** the "TEST MODE" page is `mock_razorpay.py`, and the caption says so.
- **To re-make it:** start both mocks, then the app with the `WA_*` and `RAZORPAY_API_BASE` test vars (no admin vars needed). Use an empty database with `INSERT INTO platform_settings (key, value) VALUES ('default_modes','direct,razorpay')`. Then run:

```bash
OUT=/tmp/sc node tests/e2e/showcase/showcase.mjs && OUT=/tmp/sc node tests/e2e/showcase/cards.mjs
node tests/e2e/mask.mjs /tmp/sc/mask.png && python3 tests/e2e/showcase/compose.py /tmp/sc 1.3
```

**Instagram posting without a real token:** run `python3 tests/e2e/mock_graph.py` (port 8793), keep the app running locally, then:

```bash
META_TOKEN=test-meta-token GRAPH_BASE=http://localhost:8793 RUPLOAD_BASE=http://localhost:8793 \
PUBLIC_BASE=http://localhost:8787 R2_LOCAL=1 SOCIAL_LOG=/tmp/published-test.json \
node scripts/social/publish.mjs post reel-6
```

The mock checks the token, that image links are reachable JPEGs, that the video was uploaded before publishing, and the carousel rules. `curl localhost:8793/_published` lists what it "posted".

**Self-signup is off in production.** Shops are created by the admin from "Get started" requests. Most suites sign sellers up directly, so start the app with `--var OPEN_SIGNUP:1` (staging has it on). `leads_test.py` tests the production flow (website form → Admin → Requests → create shop → seller changes PIN → admin resets PIN), so run it **without** `OPEN_SIGNUP`, with `--var ADMIN_PHONES:919999999999 --var ADMIN_SETUP_CODE:setup-code`.

**Why `--local-upstream localhost:8787`:** the production domain is in `wrangler.jsonc`, so without it the local app thinks its address is `khatakhat.co.in` and payment "return" links point at the live site instead of your machine.

**Cash on delivery, delivery charges, order alerts:** `cod_test.py` (COD journey, 18 checks), `delivery_test.py` (delivery fee, free-above limit, once per cart, unique paise below the price, plan-page value line, 11 checks) and `push_test.cjs` (order alerts via Web Push, 11 checks). The push test acts as the seller's browser, so it needs `python3 tests/e2e/mock_push.py &` (a stand-in push service on :8794), the test VAPID keys and `PUSH_ALLOW_ANY=1` in `.dev.vars`, and the `http_ece` npm package for independent decryption: `npm i http_ece` somewhere, then run with `NODE_PATH=<that>/node_modules node tests/e2e/push_test.cjs`. Production VAPID keys are in `~/.khatakhat/vapid-production.json` (already set as secrets).
