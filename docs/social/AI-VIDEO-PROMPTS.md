# Photoreal AI reels – prompts

Reels 18–20 are illustrated versions of these ideas, made in `tests/e2e/social/reels.html`. For photoreal versions like the "truck rescue" style, generate the footage in an AI video tool (Veo, Kling, Runway, Sora). Then put the real NukkadSale ending on it: the last two scenes of the matching reel (the real app screen and the end card).

**Rules for every clip**
- **One physical scene that a seller understands with the sound off.** The seller's business is the object in trouble, labelled "YOUR SALES", "YOUR SHOP" or "YOUR WHATSAPP SHOP". NukkadSale is the thing that fixes it.
- **No fake app UI inside the AI footage.** Only the real screens at the end show the product (see CONTENT-STRATEGY rule 1).
- **No other brands:** no logos, number plates or recognisable products from real companies.
- **Indian setting:** street, market, highway, home workshop.
- **Format and length:** 9:16, 6–8 seconds for the AI part. The real-app ending adds about 5 seconds.

---

### 1. The leaky bucket (matches Reel 18)
> Vertical 9:16, photoreal, a busy Indian street market at golden hour. A large steel bucket painted with the words "YOUR SALES" sits on a wooden cart. Gold coins pour into it from above, but water and coins spray out of four holes in its side. A shopkeeper's hands try to cover the holes and fail. A bright orange patch with a white tick flies in and seals each hole, one after another. The bucket fills to the brim and coins overflow and sparkle. Smooth handheld camera, shallow depth of field, cinematic, no text other than "YOUR SALES".

### 2. The fast lane (matches Reel 19)
> Vertical 9:16, photoreal aerial drone shot of an Indian highway toll plaza. One booth labelled "YOU" has a long queue of honking cars, and drivers lean out impatiently. A new lane with a green booth opens on the right with a whoosh. The cars switch lanes and glide through one by one without stopping, each windscreen flashing a small green tick. Daylight, crisp, cinematic motion, no real company logos or number plates.

### 3. The juggler (matches Reel 20)
> Vertical 9:16, photoreal, a young Indian boutique owner in a small home studio full of kurtas, juggling five objects: a phone buzzing with messages, a paper notebook, a stack of printed payment screenshots, a cardboard parcel and a folded kurta. She speeds up and the folded kurta falls and lands on the floor. Freeze frame, then all five objects are gently pulled into a single phone in her hand, which glows softly. Warm indoor light, natural, cinematic.

### 4. The overloaded scooter (new)
> Vertical 9:16, photoreal, an Indian street. A delivery scooter labelled "YOUR WHATSAPP SHOP" is piled impossibly high with parcels, notebooks and phones and wobbles dangerously. A second rider on an orange scooter pulls alongside, takes half the load onto a neat rack and steadies the first scooter. Both ride off smoothly side by side. Daylight, dynamic tracking shot, no real brand logos.

### 5. The crowded counter (new)
> Vertical 9:16, photoreal, a tiny shop counter labelled "YOUR SHOP" with a crowd of hands reaching in from every side, holding phones and money and pointing at the last kurta on a hanger. The shopkeeper looks overwhelmed. Time slows. The crowd turns into a calm, orderly line of people each holding a phone showing a green tick, and the last kurta goes neatly to the first person. Warm market light, cinematic, slow motion.

**After generating:** cut the clip to under 8 seconds and add the matching NukkadSale ending. For example, render the reel's last two scenes with `node render.mjs <n>` and join them with ffmpeg. Upload through `publish.mjs` like any other reel.
