# Social content (reels, posts, stories)

Outputs live in `docs/social/` (captions and posting plan in `docs/social/CAPTIONS.md`).

To re-make them, with the app running locally on the showcase data (see `../README.md`):

```bash
node capture.mjs ./img <showcase-out-dir>     # real app screens → img/
KURTA=… DUP=… OUD=… node capture.mjs ./img <showcase-out-dir>   # sale ids from the showcase run
for n in 1 2 3 4 5 6 7 8 9 10; do node render.mjs $n; done && python3 audio.py 1 2 3 4 5 6 7 8 9 10   # reels → out/ (10 = promo)
node shoot.mjs                                 # posts and stories → out/
```

Website screens for the newer features (storefront, cart offer, scheduled drop, discount, courier booking, tracking)
come from their own fresh shop – app started with `--var OPEN_SIGNUP:1 --var SHIPROCKET_API_BASE:http://localhost:8795`
and `tests/e2e/mock_shiprocket.py` running:

```bash
node capture-site.mjs /tmp/site && for f in /tmp/site/*.png; do cwebp -quiet -resize 540 0 -q 80 "$f" -o ../../../public/site/$(basename "$f" .png).webp; done
```

`reels.html#<n>` and `posts.html#<id>` can also be opened in a browser to preview.

Rule for every reel: the hook is on screen at frame 0 (`data-a="hit"` or `"vis"`), a second beat lands by ~1.2 s, and the product shows by ~3 s. Show only features that are live in production.
