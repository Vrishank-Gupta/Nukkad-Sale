# NukkadSale brand ambassador – brief and scripts

She is NukkadSale's face: a spokesperson who recommends the app, the way a celebrity endorses a brand. She is
**not** presented as a seller, a customer or a real person who used the app – she presents it.

## Rules (keep the account safe and the brand credible)
- **Label every video "AI info"** in Instagram (and "Altered or synthetic content" on YouTube). Both platforms require it for realistic AI people; unlabelled AI faces get reach cut or removed.
- **She never claims results** ("I made ₹2 lakh with this") or poses as a seller. She explains and demonstrates. Real seller stories, with permission, come from real sellers.
- **She never looks like a copy of a real person** – no celebrity look-alikes, no photos of real people as the source.
- **Professional and attractive**: polished, confident, warm – the kind of person sellers trust with their business. Not sexualised: our buyers and sellers are families, aunties and small shop owners.
- **Always end on the real app.** Her clip is the hook and the explanation; the last 5–8 seconds are real NukkadSale screens (re-use the endings of the reels in `tests/e2e/social/reels.html`).

## Persona
- **Name:** Naina (works in English and Hindi; short, easy to say, not tied to one region).
- **Age and look:** late 20s, Indian, natural skin tone, shoulder-length dark hair, light everyday make-up, a small bindi optional. Expressive eyes and a quick smile – she looks like the smartest friend who runs a successful boutique.
- **Wardrobe** (rotate): kurta with a thin dupatta in NukkadSale orange (#e2560c) or mustard; a crisp off-white shirt with a blazer; a cotton saree with a simple blouse for festival content. No logos except a small NukkadSale pin.
- **Setting:** a bright, real-looking home studio – a rack of kurtas, a packing table with parcels, a ring light out of frame. Same set every time, so viewers recognise her.
- **Voice:** warm, clear, quick – "didi who knows the shortcut". Hinglish by default (English sentences, Hindi words where natural: *hisaab, bechna, maal, ekdum*). Full Hindi versions for Hindi reels.
- **Catchphrases:** "Post once, let the link work." · "Har order ka apna amount." · "Aapki dukaan, WhatsApp pe."

## How to make her realistic (lip sync, natural movement)
I can't generate a realistic person on this machine; these are the tools that do it well today:

1. **Create her face once.** Generate 3–4 portrait photos of the persona (Midjourney / Ideogram / Flux) from the prompt below, pick one, and keep it as her master image.
   > Photorealistic portrait of a confident Indian woman in her late twenties, shoulder-length dark wavy hair, warm natural smile, light make-up, wearing a mustard cotton kurta with an orange dupatta, standing in a bright home boutique studio with a rack of colourful kurtas behind her, soft daylight, 50mm lens, shallow depth of field, natural skin texture, vertical 9:16, looking at camera.
2. **Make her talk.** Use **HeyGen (Avatar IV / photo avatar)** or **Captions.ai** with the master image: paste a script below, pick a natural voice (or clone one in **ElevenLabs** – English and Hindi), and render 9:16. These give the best lip sync, head movement, blinks and hand gestures for Hindi and English. Turn **on** "expressiveness"/"gestures", keep the background as her studio.
3. **Edit.** Cut to 15–30 s, add burned-in captions (most people watch muted), then append the matching real-app ending. Export 1080×1920, H.264 + AAC.
4. **Post** through `scripts/social/publish.mjs` like any reel (add it to `ITEMS` and `schedule.json`), and tick **AI info** when you see the reel in the app.

## Scripts (formats we don't have yet – each ~20–30 s + real-app ending)

### 1. Talking head – "Here's why your WhatsApp sale isn't working"
> (to camera, direct) Here's why your WhatsApp sale isn't working. You post a beautiful kurti… and then you spend three hours typing "₹799, S M L" to fifty people. By the time you reply, they've bought from someone else. Fix: post once – with a link. Buyers see the price and sizes, pick, and pay you on UPI. You just pack. *Post once, let the link work.* → **ending: Reel 2 last two scenes**

### 6. Green screen – "Everyone's talking about WhatsApp catalogues. Here's what's missing."
> (Naina small in the corner, a WhatsApp catalogue screenshot behind her) Everyone says "just use the WhatsApp catalogue". Nice for showing products – but look: no stock, no payment, no idea who paid, no hisaab. The catalogue shows. NukkadSale *sells*: stock held while they pay, an exact amount per order, and a khata that writes itself. → **ending: real home screen**

### 8. Voiceover + B-roll – "This is how I'd run a boutique every day"
> (her voice over real app screens: new sale → share → orders → labels → khata) Morning: add today's product – photo, price, sizes. Share the link in my groups. While I have chai, orders come in by themselves. Afternoon: every payment checked – the amount tells me who paid. Evening: labels printed, courier booked, and the khata already shows today's profit. That's the whole job. → **ending: end card**

### 10. Storytime – "How one kurti got sold to three people"
> (to camera, storytelling) Picture this. The last mustard kurti. Three buyers say "mine!" in the same minute. Two pay. One gets it, the other wants a refund, the third is angry in your DMs. Sound familiar? It happens because DMs can't hold stock. With an order link, the first buyer gets it, it's held while she pays, and everyone else joins the waitlist. Nobody angry. → **ending: Reel 3 (last piece) ending**
*(Told as a common seller situation – not as a real person's story.)*

### 14. Day in the life – "A day in the life of a WhatsApp seller – with NukkadSale"
> (quick cuts of her in the studio: posting, sipping chai, packing, laughing) 9 am – post the new drop. 9:05 – orders already coming in. 11 – check payments in one tap. 2 pm – print labels, book the courier. 6 pm – a buyer sends a review with a photo. 9 pm – khata says today's profit. And I didn't type "price?" once. → **ending: end card**

### 18. Remix a creator – "He's right, but here's what's missing"
> (reacting to a generic "how to sell on WhatsApp" tip – use a stock or your own clip, never someone else's content without permission) He's right – post consistently and use good photos. But here's what's missing: how do you take fifty orders without fifty chats? One link per product, an exact amount per order, stock that holds itself. That's the part nobody tells you. → **ending: Reel 17 ending**

### 11. 30-day experiment – **only with a real seller**
> Don't script results. Run it for real with one pilot seller who agrees to be filmed: "I moved my WhatsApp shop to one link for 30 days." Naina introduces it; the seller shows her real numbers at the end. Until then, skip this format.

## Captions for Naina's reels
Same style as `CAPTIONS.md`: hook line, 2–3 lines of value, "Link in bio → nukkadsale.in", 4–6 hashtags. Add **#AIgenerated** isn't required, but the in-app **AI info** label is.
