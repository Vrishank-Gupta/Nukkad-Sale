# NukkadSale – what goes where (Instagram + Facebook)

For: whoever posts for NukkadSale. Audience: small sellers who sell in WhatsApp groups – boutique owners,
resellers, home businesses, mostly on phones, English + Hindi/Hinglish.

## The rules that never change

1. **Show the real product.** Every screen is a real screenshot of the current app, in the state a real user
   sees it. No mock-ups that look like the app. Re-capture after every UI change (`tests/e2e/social/capture.mjs`).
2. **Only features that are live.** Ordering inside the WhatsApp chat is shown only while the WhatsApp bot is
   on in production. Until then: the website order link.
3. **No prices, no "free".** Don't promise plan prices, trials or "free forever". Gateway fees: "Razorpay
   charges its own fee".
4. **Paise go below the price.** A ₹799 item is paid as ₹798.xx, never ₹799.xx – that's how the app works.
5. **Hook in the first frame.** The first thing anyone sees – first reel frame, first story, first carousel
   slide – states the problem or the promise. No logos-first openers.
6. **Same brand, varied looks.** Same brand everywhere – the storefront mark, orange `#d9480f` accents, line
   icons (not emoji) in visuals; emoji are fine in captions. But vary layouts and palettes (rule 7).
7. **Never repeat yourself.** Each new post, carousel, story series or reel must look and read different from
   the last few on the grid: change at least the layout (split / centred phone / typographic / cards), the
   palette (cream, dark, orange, green, night-green) and the angle (pain → fix, how-to, proof, scale, myth,
   Hindi). Don't reuse a slide structure, cover style or claim from the previous 3 feed items – if a point was
   already made, make a different one or drop it. Before posting, put the new item next to the last 3 on the
   grid and check they don't look like a set.

8. **Say what NukkadSale is, every time.** A seller who scrolled the grid thought we sell "a WhatsApp message
   organiser and a payment method", because every post showed one feature or one pain. So: every post and story
   carries the brand bar tagline **App for WhatsApp sellers**, every reel end card says **The app for WhatsApp
   sellers**, and every caption gets the one-line definition (`publish.mjs` adds it above the hashtags unless the
   caption already says it). Keep the explainers – Reel 17, Post 18, Post 19 – pinned at the top of the grid.
   Feature posts should show the feature *inside the shop* (shop link → order → payment → khata), not alone.
   Never delete posted items; improve what hasn't gone out yet.

## What each format is for

| Format | Job | Lives | What goes in it | How often |
|---|---|---|---|---|
| **Feed posts** (single image or carousel) | Stop the scroll, get **saved and shared**, build the grid a new visitor judges you by | Forever | One problem + one answer per post. Carousels for step-by-step ("Post → Paid in 4 steps"). Myth-busting ("screenshots can be faked"). Before/after (notebook → khata). | 2–3 a week |
| **Stories** | **Talk to people who already follow** – teach, ask, nudge, link | 24 h, then saved into Highlights | Short series (5–8 frames) that teach one topic; polls and quizzes; "new feature" announcements; link sticker to nukkadsale.in; reshares of new posts | 3–5 days a week |
| **Highlights** | The **permanent menu** on the profile: answers a new visitor's questions in the order they ask them | Forever | The best story series, one topic each | Update when a series changes |
| **Reels** | Reach new people (not covered here yet – see `CAPTIONS.md`) | Forever | – | – |

### Feed posts – content buckets (rotate them)

1. **Pain → fix** (40%) – a problem every group seller knows, and how NukkadSale removes it.
   Examples: fake screenshots (Post 7), chasing payments (Post 8), "who paid?" (Post 3).
2. **How-to carousels** (25%) – save-worthy steps with real screens. Example: Post 2.
3. **Proof of the product** (20%) – one real screen, one sentence. Example: Post 6, Post 9.
4. **Hindi / Hinglish** (15%) – the same ideas for Hindi-first sellers. Example: Post 4.

Caption shape: hook line → 2–3 lines on the fix → "Link in bio" → 4–7 hashtags. Ask a question at the end
when it fits ("Tag a seller who…").

### Stories – what to put in them

- **Teaching series** (5–8 frames, one topic) – these become Highlights. Frame 1 = hook + "Tap to see how";
  frames 2–(n−1) = one step or one idea per frame with a real screen; last frame = CTA with a Link sticker.
  Put a "2/8" counter on every frame so people know there's more.
- **Interactive** – polls ("Orders kaise lete ho? DM / Form"), quizzes ("Why ₹798.79?"), sliders. Answer
  the quiz the next day by resharing the matching post.
- **Reshares** – every new feed post gets reshared to stories the same day with a "New post" sticker.
- **Announcements** – new features, only once live.

Instagram covers the top ~12% (progress bars, profile) and the bottom ~15% (reply bar) of a story – keep
text and phones in the middle. Leave a clear area for stickers.

### Highlights – the profile menu (in this order)

| # | Title | Cover (`profile/highlights/`) | Series (`stories/series/`) | Status |
|---|---|---|---|---|
| 1 | **How it works** | `1-how-it-works.png` | `how-1 … how-8` | Posted 2026-11-02 – add to highlight in the app |
| 2 | **Payments** | `2-payments.png` | `pay-1 … pay-6` | Ready |
| 3 | **Khata** | `3-khata.png` | `khata-1 … khata-5` | Ready |
| 4 | **FAQ** | `5-start-here.png` (or a new "?" cover) | `faq-1 … faq-6` | Ready |
| 5 | **हिंदी** | `4-hindi.png` | Story 4 + Hindi versions of the series (to make) | Later |

Post one series per week as stories (all frames the same day, a few minutes apart), then add them to the
matching Highlight. Re-post a series when the app changes so the Highlight never shows an old screen.

**Adding a highlight (Instagram app, after the stories are up):** profile → **+ New** under the bio → pick the
series' stories in order → Next → **Edit cover** → choose the cover from `profile/highlights/` in your gallery
→ type the title → Done. Highlights can't be created through the API.

**Facebook:** the Page token can't post stories yet (it needs `pages_manage_posts`). Until then, upload the
same frames as Page stories from the Facebook app (or Meta Business Suite → Stories). Facebook has no
Highlights – the series simply runs for 24 h there.

## Weekly rhythm

| Day | Feed | Stories |
|---|---|---|
| Mon | Pain → fix post | Story series of the week (all frames) |
| Tue | – | Poll or quiz |
| Wed | How-to carousel | Reshare Wednesday's post |
| Thu | – | Quiz answer / FAQ frame |
| Fri | Proof or Hindi post | Reshare + Link sticker |
| Sat–Sun | (optional) | One behind-the-scenes or seller question |

Post between 7 and 10 pm (sellers are free after work). Reply to every comment and DM within the hour.

## Where things live

- Story series source: `tests/e2e/social/stories.html` → render with `node shoot-stories.mjs` (needs `img/`
  from `capture.mjs`). Output: `docs/social/stories/series/`.
- Posts and the post schedule: `CAPTIONS.md`. Profile, bio, highlight covers: `profile/PROFILE.md`.
- Posting: `node scripts/social/publish.mjs post <id>` (posts and stories without stickers);
  stickers, highlights and Facebook are done in the apps.
