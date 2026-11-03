import { Hono } from 'hono'
import type { Context } from 'hono'
import type { Child } from 'hono/jsx'
import { raw } from 'hono/html'
import type { AppEnv } from '../env'
import { getLang } from '../i18n'
import { currentSeller } from '../lib/auth'
import { sha256 } from '../lib/crypto'
import { CHANNELS, PAYMENTS, VOLUMES } from '../lib/leads'
import { notifyOwner } from '../lib/mail'
import { displayPhone, normalizePhone, waLink } from '../lib/util'
import { waBotEnabled } from '../lib/whatsapp'
import { ICONS } from '../views/layout'
import { TRACK_JS } from '../lib/analytics'

// Line icons (same set as the app) – the site uses no emoji as icons.
const svgIcon = (n: string, s = 24) => raw(`<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${(ICONS as Record<string, string>)[n] ?? ''}</svg>`)

/*
 * Marketing site at "/" and the "Get started" request form. Shops are created by the admin
 * from these requests (Admin → Requests). Every claim here must match the live product: the
 * WhatsApp-chat ordering parts only show while the WhatsApp bot is switched on.
 * Images are real app screens, served as static files from /site/ (public/site).
 */
export const site = new Hono<AppEnv>()


const C = {
  en: {
    title: 'NukkadSale – the app that runs your WhatsApp business',
    desc: 'An app for people who sell on WhatsApp: it takes your orders, collects UPI payments (and tells you who paid), books couriers and keeps your khata. हिंदी + English.',
    nav: ['How it works', 'What it does', 'For buyers', 'Pricing', 'FAQ'], login: 'Seller login', loginShort: 'Login', ctaShort: 'Start', cta: 'Get your shop', other: 'हिंदी', otherLang: 'hi',
    badge: 'For people who sell on WhatsApp & Instagram',
    h1a: 'The app that runs', h1b: 'your WhatsApp business.',
    sub: 'You keep selling in your groups. NukkadSale takes the orders, collects the money, books the courier and writes your accounts – all on your phone.',
    heroJobs: [['bag', 'Orders', 'Buyers order themselves'], ['wallet', 'Payments', 'Straight to your UPI'], ['box', 'Delivery', 'Courier booked in a tap'], ['book', 'Accounts', 'Khata writes itself']],
    heroCta: 'Get your shop', heroCta2: 'See how a sale works', heroNote: 'Free to start. We set it up with you on WhatsApp.',
    notShop: 'Not a shopping website – this is the app sellers use to run their shop.',
    videoCap: 'A real sale on NukkadSale, from the seller’s phone', videoAlt: 'A sale on NukkadSale: add a product, share it, buyer orders and pays, seller confirms, books a courier, khata updates',
    howEyebrow: 'How it works', howH: 'One sale, start to finish', howP: 'You post the product and tap “Yes” once. NukkadSale does the rest.',
    steps: [
      ['orders', 'You post your product', 'Add a photo, price and sizes. Share the link in your WhatsApp groups and status.'],
      ['payments', 'The buyer orders and pays', 'They pick a size and pay your UPI. Every order has its own exact amount, so you see who paid.'],
      ['delivery', 'The parcel goes out', 'Compare courier rates, book the pickup and print the label. The buyer tracks it.'],
      ['accounts', 'Your accounts are done', 'Every sale lands in your khata, with your profit. No notebook.'],
    ],
    jobsEyebrow: 'For you · What it does', jobsH: 'Four jobs you do by hand today. One app does them.', jobsP: 'Tap any of them to see how it works.',
    jobs: [
      ['orders', 'bag', 'Orders & stock', 'Instead of answering every DM and a notebook of who ordered', ['Your own shop link with every product', 'An order link for each product, for your groups', 'Cart – many items, one payment', 'Stock held while buyers pay – never sold twice'], 'How orders work'],
      ['payments', 'wallet', 'Payments', 'Instead of checking payment screenshots', ['Money goes straight to your UPI ID', 'Each order has an exact amount – you see who paid', 'GPay, PhonePe, Paytm – any UPI app', 'Cash on delivery and automatic payments too'], 'How payments work'],
      ['delivery', 'box', 'Delivery', 'Instead of calling couriers and writing addresses', ['Courier rates and dates for the buyer’s pincode', 'Book and schedule the pickup in one go', 'Address labels for every parcel', 'Buyers track their parcel themselves'], 'How delivery works'],
      ['accounts', 'book', 'Accounts', 'Instead of an Excel sheet at month end', ['A khata that fills itself', 'Profit per piece and for the month', 'Your buyers list, repeat buyers marked', 'Excel download for your CA'], 'How accounts work'],
    ],
    grow: ['tag', 'Plus: tools to sell more', 'Discounts, a special price for one buyer, a back-in-stock list, launch countdowns and “spend more, save more”.', 'See the selling tools'],
    buyEyebrow: 'For your buyers', buyH: 'Your buyers get what big online shops give.',
    buyP: 'When buyers trust a link from your WhatsApp group, they pay – and come back. Every order comes with this, automatically.',
    buyTiles: [
      ['timeline', 'They always know where their order is', 'A timeline from “Order placed” to “Delivered” – with your photo of their packed parcel.'],
      ['receipt', 'A proper payment receipt', 'Once you confirm, they get a receipt to save, print or forward. No more “did you get my money?”.'],
      ['size', 'The right size, first time', 'Your size chart on the sale, a one-tap “Ask my size”, and their size remembered for next time.'],
      ['reviews', 'Reviews from real buyers', 'After delivery they rate it and add a photo. Shown on your shop – and you choose what is shown.'],
      ['advance', 'Cash on delivery, without the risk', 'Ask for a small UPI advance before you pack. Fewer fake orders and refused parcels.'],
    ],
    buyProtect: 'It protects you too: fewer “where is my order?” messages, proof of every step, and less money lost to cash on delivery.',
    buyMore: 'See everything buyers get',
    newPill: 'New: Live drops and Ask your buyers',
    newEyebrow: 'To sell more · Only on NukkadSale', newH: 'Two ways to sell more that no other app has',
    newP: 'Made for how WhatsApp sellers really sell: big launches in the group, and buying stock from suppliers.',
    newCards: [
      ['live', 'Live drops', 'Make every sale an event.', 'Announce a time. Buyers get a countdown and a reminder, then watch the pieces run out live – “Only 4 left!”, “Pooja just bought one”. The whole group turns up, and the stock is gone in minutes.',
        ['Countdown and “Remind me when it starts”', 'Pieces left and who just bought – live', '“Sold out in 12 minutes” on the page'], 'How live drops work'],
      ['ask', 'Ask your buyers', 'Know what sells before you buy stock.', 'Got new designs from your supplier? Show them to your buyers first. They tap the ones they want and can pay a small reserve. Order only what will sell – then one tap tells every buyer it has arrived.',
        ['Votes on each design, with sizes', 'A reserve that comes off the price later', 'Most-wanted design to a live sale in one tap'], 'How asking works'],
    ],
    dayEyebrow: 'Your day', dayH: 'Before and after NukkadSale', dayCols: ['Job', 'Today', 'With NukkadSale'],
    day: [
      ['Taking orders', '“Price?” “Size?” in 50 DMs', 'Buyers order from your link'],
      ['The last piece', 'Promised to three people', 'Held for the first buyer; others join the waitlist'],
      ['Payments', 'Scrolling through screenshots', 'The exact amount tells you who paid'],
      ['Delivery', 'Calling couriers, writing every address', 'Best rate booked, labels printed'],
      ['Accounts', 'Notebook and Excel at month end', 'Khata and profit, already done'],
    ],
    whoEyebrow: 'Who it is for', whoH: 'Made for sellers like you', whoP: 'If you sell in WhatsApp groups, on status or in Instagram DMs, NukkadSale is for you.',
    who: [['shop', 'Boutiques & clothing', 'Kurtis, sarees, suits, kids’ wear'], ['tag', 'Jewellery & accessories', 'Earrings, bags, watches, perfume'], ['bag', 'Home food & bakers', 'Pickles, cakes, sweets, snacks'], ['users', 'Resellers & wholesalers', 'Many products, many buyers']],
    all: (bot: boolean): [string, string, [string, string][]][] => [
      ['bag', 'Taking orders', [
        ['An order link for every product', 'Paste it in groups and on status. Buyers order in seconds – no app, no sign-up.'],
        ...(bot ? [['Orders inside WhatsApp', 'Buyers tap your post and order in the chat. The ordering bot asks size and address.'] as [string, string]] : []),
        ['Cart, one payment', 'Kurta + dupatta + earrings – one checkout, one amount to check.'],
        ['Order from a chat', 'Buyer DMed you? Pick the items and send a ready message with the total and a pay link.'],
        ['Drops that open on time', 'Announce a launch. Buyers see a countdown and the sale opens on the minute.'],
        ['Photos, sizes, limits', 'Up to 5 swipeable photos, sizes or weights, and a limit per buyer.'],
        ['Your stock stays private', 'Buyers see “Available”, “Selling fast” or “Sold out” – never your count.'],
      ]],
      ['wallet', 'Getting paid', [
        ['An exact amount per order', 'Every order has its own paise, so you see who paid at a glance.'],
        ['Any UPI app', 'One Pay button on Android, GPay / PhonePe / Paytm buttons on iPhone, a QR code on a computer.'],
        ['More than one UPI ID', 'Shop and personal – choose which one each sale pays into.'],
        ['Cash on delivery', 'Turn on COD for any sale, with an extra COD charge if you want one.'],
        ['Automatic payments', 'Busy? Payments through your own Razorpay account confirm themselves.'],
        ['Screenshots, checked', 'Buyers can send a screenshot; you see it with a reminder to check your UPI app.'],
      ]],
      ['tag', 'Selling more', [
        ['Discounts', 'The old price is struck through on the page and in your group post.'],
        ['A special price for one buyer', 'A private link with her price. Nobody else gets it.'],
        ['“Spend more, save more”', 'Set it once – it shows on every product and applies itself.'],
        ['Back-in-stock list', 'Sold out? Buyers ask to be told. Restock and message them in one tap each.'],
        ['Sell again in one tap', 'Photos, price and sizes come back pre-filled.'],
        ['Share with photos', 'Photos and caption go to WhatsApp together, just like your normal post.'],
      ]],
      ['box', 'Packing and delivery', [
        ['A to-send list', 'Paid → Packed → Sent → Delivered, and buyers see every step.'],
        ['Address labels', 'Print every label at once – 8 on an A4 page, COD amount included.'],
        ['Compare and book couriers', 'Rates and delivery dates for the buyer’s pincode. Book and schedule the pickup in one go.'],
        ['Tracking for buyers', 'Their order page shows every scan – fewer “where is my parcel?” messages.'],
        ['Failed deliveries, sorted', 'Ask for another attempt, take it back, send again or restock.'],
        ['Delivery charges your way', 'A delivery fee per sale, free above an amount you choose.'],
      ]],
      ['book', 'Knowing your numbers', [
        ['A khata that writes itself', 'Every paid order is added. Cash sales and expenses in one tap.'],
        ['Profit, not just sales', 'Add your cost once – see profit per piece and for the month.'],
        ['Excel for your CA', 'Download the full khata whenever you need it.'],
        ['Your week at a glance', 'Sales chart, orders, average order and money still to come.'],
        ['Know your buyers', 'Ranked by spend, repeat buyers marked, WhatsApp them in one tap.'],
        ['Broadcast-ready contacts', 'Export buyer numbers for your WhatsApp broadcast lists.'],
      ]],
      ['phone', 'Made for your phone', [
        ['हिंदी + English', 'Every screen and every buyer message. Switch with one tap.'],
        ['It reads aloud', 'Tap Listen and the screen’s instructions are read out to you.'],
        ['“New order” alerts', 'Spoken alert and a buzz while the app is open, a phone notification when it isn’t.'],
        ['Home is a to-do list', '“2 payments to check · 5 orders to send” – just start at the top.'],
        ['Opens like an app', 'Add it to your home screen from Chrome or Safari. Works on a computer too.'],
        ['Only the tools you want', 'Switch off anything you don’t use in Settings.'],
      ]],
    ],
    priceEyebrow: 'Pricing', priceH: 'Simple monthly plans. No commission.',
    priceP: 'Start free. Pay a flat monthly fee only when you sell more – never a cut of your sales.',
    plans: [
      { name: 'Shuruaat', price: '₹0', per: 'free', limit: 'Up to 30 paid orders a month', tag: 'For trying it out', extra: 'Every feature included. Nothing to pay to start.', cta: 'Start free' },
      { name: 'Dukaan', price: '₹999', per: '/month', limit: 'Up to 300 paid orders a month', tag: 'For regular sellers', extra: 'Every feature, ten times the orders.', cta: 'Choose Dukaan' },
      { name: 'Badi Dukaan', price: '₹1,999', per: '/month', limit: 'Unlimited orders', tag: 'For busy sellers', extra: 'Plus automatic payments with Razorpay and priority help on WhatsApp', cta: 'Choose Badi Dukaan' },
    ],
    planIncl: 'Every plan includes', incl: ['Your shop link and order links', 'Exact-amount UPI payments', 'Stock held while buyers pay', 'Khata and profit', 'Discounts, special prices, waitlist', 'Address labels and courier booking', 'Buyers list', 'हिंदी + English'],
    priceNote: 'No commission on your sales – money goes straight to your UPI ID or your own Razorpay account (Razorpay charges its own fee). We set up your shop with you on every plan.',
    faqEyebrow: 'FAQ', faqH: 'Questions sellers ask',
    faq: (bot: boolean) => [
      ['What is NukkadSale, exactly?', 'An app for people who sell on WhatsApp and Instagram. It takes your orders, collects payments straight to your UPI (and tells you who paid), books couriers and keeps your khata. It is not a shopping site or a marketplace – your buyers stay yours.'],
      ['Do my buyers need to install anything?', bot ? 'No. They order inside WhatsApp, or from your link in any browser.' : 'No. They open your link in any browser, pick a size and pay. No app, no sign-up.'],
      ['Will my buyers trust a link?', 'They see your shop name, your real WhatsApp number and reviews from your past buyers. After ordering they get a timeline of every step – with a photo of their packed parcel – and a proper payment receipt.'],
      ['Is my money safe?', 'NukkadSale never holds your money. Buyers pay your own UPI ID, or your own Razorpay account if you use automatic payments.'],
      ['Do I need a courier account?', 'No. Send parcels however you like and print address labels from NukkadSale. If you have a courier account, connect it to compare rates, book pickups and share tracking.'],
      ['Can I use it in Hindi?', 'Yes. Every screen, and everything your buyers see, works in Hindi and English.'],
      ['How do I start?', 'Fill the short form below. We message you on WhatsApp, set up your shop with you and send your login. Most sellers post their first product the same day.'],
      ['What does it cost?', 'Shuruaat is free for up to 30 paid orders a month. Dukaan is ₹999 a month for up to 300 orders, and Badi Dukaan is ₹1,999 a month with unlimited orders. No commission on your sales.'],
    ],
    menu: 'Menu', swipe: 'Swipe to see all four steps →', stickyCta: 'Free to start. We set it up with you.',
    featNav: 'What it does', allJobs: 'The four jobs', backHome: '← Home', featGet: 'What you get', featSteps: 'How it works', featMore: 'See the other jobs', featCtaH: 'Ready to try it?', featCtaP: 'Free to start. We set up your shop with you on WhatsApp.',
    formEyebrow: 'Get started', formH: 'Get your shop', formP: 'Leave your name and WhatsApp number. We’ll message you, set up your shop with you and send your login.',
    f: { more: 'Tell us more about your business (optional)', name: 'Your name', business: 'Shop / business name', phone: 'WhatsApp number', city: 'City', sells: 'What do you sell?', sellsPh: 'e.g. kurtis, sarees, jewellery', channel: 'Where do you sell today?', volume: 'How many orders a month?', payments: 'How would you like to get paid?', message: 'Anything else? (optional)', choose: 'Choose…', submit: 'Request a call back', consent: 'By sending this you agree to be contacted on WhatsApp or phone about NukkadSale. See our', privacy: 'privacy policy' },
    errs: { fill: 'Please fill your name, business name and WhatsApp number.', phone: 'Please enter a valid 10-digit mobile number.', many: 'Too many requests from this device today. Please message us on WhatsApp instead.' },
    thanksH: 'Thank you!', thanksP: (p: string) => `We got your request. We’ll message you on WhatsApp at ${p} soon to set up your shop.`, thanksWa: 'Message us now on WhatsApp', back: '← Back to home',
    footer: 'The app for people who sell on WhatsApp.', policies: [['/privacy', 'Privacy'], ['/terms', 'Terms'], ['/refunds', 'Refunds'], ['/contact', 'Contact']],
  },
  hi: {
    title: 'NukkadSale – आपका WhatsApp बिज़नेस चलाने वाला ऐप',
    desc: 'WhatsApp पर बेचने वालों का ऐप: ऑर्डर लेता है, UPI पेमेंट लेता है (और बताता है किसने भेजा), कूरियर बुक करता है और खाता रखता है। हिंदी + English।',
    nav: ['कैसे काम करता है', 'क्या करता है', 'ग्राहकों के लिए', 'क़ीमत', 'सवाल'], login: 'सेलर लॉग इन', loginShort: 'लॉग इन', ctaShort: 'शुरू करें', cta: 'अपनी दुकान पाएं', other: 'English', otherLang: 'en',
    badge: 'WhatsApp और Instagram पर बेचने वालों के लिए',
    h1a: 'आपका WhatsApp बिज़नेस', h1b: 'चलाने वाला ऐप।',
    sub: 'आप अपने ग्रुप में बेचते रहें। NukkadSale ऑर्डर लेता है, पैसे लेता है, कूरियर बुक करता है और हिसाब लिखता है – सब आपके फ़ोन पर।',
    heroJobs: [['bag', 'ऑर्डर', 'ग्राहक ख़ुद ऑर्डर करें'], ['wallet', 'पेमेंट', 'सीधे आपकी UPI में'], ['box', 'डिलीवरी', 'एक टैप में कूरियर'], ['book', 'हिसाब', 'खाता अपने आप']],
    heroCta: 'अपनी दुकान पाएं', heroCta2: 'देखें एक सेल कैसे होती है', heroNote: 'शुरुआत मुफ़्त। WhatsApp पर हम आपके साथ सेट-अप करेंगे।',
    notShop: 'यह शॉपिंग वेबसाइट नहीं है – यह वो ऐप है जिससे सेलर अपनी दुकान चलाते हैं।',
    videoCap: 'NukkadSale पर एक असली सेल, सेलर के फ़ोन से', videoAlt: 'NukkadSale पर एक सेल: प्रोडक्ट डालें, शेयर करें, ग्राहक ऑर्डर और पेमेंट करे, सेलर पक्का करे, कूरियर बुक करे, खाता अपडेट हो',
    howEyebrow: 'कैसे काम करता है', howH: 'एक सेल, शुरू से आख़िर तक', howP: 'आप प्रोडक्ट डालें और एक बार “हाँ” टैप करें। बाकी NukkadSale करता है।',
    steps: [
      ['orders', 'आप प्रोडक्ट डालें', 'फ़ोटो, दाम और साइज़ डालें। लिंक WhatsApp ग्रुप और स्टेटस में शेयर करें।'],
      ['payments', 'ग्राहक ऑर्डर और पेमेंट करे', 'साइज़ चुनें और आपकी UPI पर भेजें। हर ऑर्डर की अपनी सही रकम, तो पता रहे किसने भेजा।'],
      ['delivery', 'पार्सल निकल जाए', 'कूरियर के रेट देखें, पिकअप बुक करें, लेबल प्रिंट करें। ग्राहक ख़ुद ट्रैक करे।'],
      ['accounts', 'हिसाब तैयार', 'हर बिक्री मुनाफ़े के साथ खाते में। कोई कॉपी नहीं।'],
    ],
    jobsEyebrow: 'आपके लिए · क्या करता है', jobsH: 'चार काम जो आप आज हाथ से करते हैं। एक ऐप करता है।', jobsP: 'किसी पर भी टैप करके देखें कैसे काम करता है।',
    jobs: [
      ['orders', 'bag', 'ऑर्डर और स्टॉक', 'हर DM का जवाब देने और कॉपी में ऑर्डर लिखने की जगह', ['हर प्रोडक्ट के साथ अपनी दुकान का लिंक', 'ग्रुप के लिए हर प्रोडक्ट का ऑर्डर लिंक', 'कार्ट – कई चीज़ें, एक पेमेंट', 'पेमेंट तक स्टॉक होल्ड – दो बार नहीं बिकता'], 'ऑर्डर कैसे होते हैं'],
      ['payments', 'wallet', 'पेमेंट', 'पेमेंट के स्क्रीनशॉट देखने की जगह', ['पैसा सीधे आपकी UPI ID में', 'हर ऑर्डर की सही रकम – पता चले किसने भेजा', 'GPay, PhonePe, Paytm – कोई भी UPI ऐप', 'कैश ऑन डिलीवरी और अपने आप पेमेंट भी'], 'पेमेंट कैसे होते हैं'],
      ['delivery', 'box', 'डिलीवरी', 'कूरियर को फ़ोन करने और पते लिखने की जगह', ['ग्राहक के पिनकोड के लिए कूरियर रेट और तारीख़', 'बुकिंग और पिकअप एक साथ', 'हर पार्सल का पते वाला लेबल', 'ग्राहक ख़ुद पार्सल ट्रैक करें'], 'डिलीवरी कैसे होती है'],
      ['accounts', 'book', 'हिसाब', 'महीने के आख़िर में Excel की जगह', ['अपने आप भरने वाला खाता', 'हर पीस और महीने का मुनाफ़ा', 'ग्राहकों की लिस्ट, बार-बार आने वाले अलग', 'CA के लिए Excel डाउनलोड'], 'हिसाब कैसे रहता है'],
    ],
    grow: ['tag', 'साथ में: ज़्यादा बेचने के टूल', 'छूट, एक ग्राहक के लिए ख़ास दाम, स्टॉक वापसी की लिस्ट, लॉन्च काउंटडाउन और “ज़्यादा ख़रीदें, ज़्यादा बचाएं”।', 'बेचने के टूल देखें'],
    buyEyebrow: 'आपके ग्राहकों के लिए', buyH: 'आपके ग्राहकों को वो मिलता है जो बड़ी ऑनलाइन दुकानें देती हैं।',
    buyP: 'जब ग्राहक को आपके WhatsApp ग्रुप के लिंक पर भरोसा होता है, वो पेमेंट करते हैं – और लौटते हैं। हर ऑर्डर के साथ यह सब, अपने आप।',
    buyTiles: [
      ['timeline', 'उन्हें हमेशा पता रहे ऑर्डर कहाँ है', '“ऑर्डर किया” से “पहुँच गया” तक की टाइमलाइन – पैक पार्सल की आपकी फ़ोटो के साथ।'],
      ['receipt', 'असली पेमेंट रसीद', 'आपके पक्का करते ही उन्हें रसीद मिले – सेव, प्रिंट या फ़ॉरवर्ड करें। “पैसे मिले?” वाले मैसेज ख़त्म।'],
      ['size', 'पहली बार में सही साइज़', 'सेल पर आपका साइज़ चार्ट, एक टैप में “मेरा साइज़ पूछें”, और अगली बार के लिए उनका साइज़ याद।'],
      ['reviews', 'असली ग्राहकों के रिव्यू', 'डिलीवरी के बाद रेटिंग और फ़ोटो। आपकी दुकान पर दिखते हैं – और क्या दिखे, यह आप चुनें।'],
      ['advance', 'बिना ख़तरे के कैश ऑन डिलीवरी', 'पैक करने से पहले थोड़ा UPI एडवांस लें। नकली ऑर्डर और लौटे पार्सल कम।'],
    ],
    buyProtect: 'यह आपको भी बचाता है: “ऑर्डर कहाँ है?” वाले मैसेज कम, हर कदम का सबूत, और कैश ऑन डिलीवरी में कम नुकसान।',
    buyMore: 'ग्राहकों को क्या-क्या मिलता है',
    newPill: 'नया: लाइव ड्रॉप और ग्राहकों से पूछें',
    newEyebrow: 'ज़्यादा बेचने के लिए · सिर्फ़ NukkadSale पर', newH: 'ज़्यादा बेचने के दो तरीके जो किसी और ऐप में नहीं',
    newP: 'WhatsApp सेलर असल में जैसे बेचते हैं, उसी हिसाब से: ग्रुप में बड़े लॉन्च, और सप्लायर से स्टॉक ख़रीदना।',
    newCards: [
      ['live', 'लाइव ड्रॉप', 'हर सेल को इवेंट बनाएं।', 'समय बताएं। ग्राहकों को काउंटडाउन और याद दिलाने का मैसेज मिले, फिर वो लाइव देखें पीस ख़त्म होते – “सिर्फ़ 4 बचे!”, “पूजा ने अभी एक लिया”। पूरा ग्रुप आ जाता है, और स्टॉक मिनटों में ख़त्म।',
        ['काउंटडाउन और “शुरू होने पर याद दिलाएं”', 'कितने बचे और किसने अभी लिया – लाइव', 'पेज पर “12 मिनट में सब बिक गया”'], 'लाइव ड्रॉप कैसे चलता है'],
      ['ask', 'ग्राहकों से पूछें', 'स्टॉक लेने से पहले जानें क्या बिकेगा।', 'सप्लायर से नए डिज़ाइन आए? पहले ग्राहकों को दिखाएं। जो चाहिए उन पर टैप करें, और चाहें तो थोड़ी होल्ड रकम दें। वही मंगाएं जो बिकेगा – फिर एक टैप में सबको बताएं कि आ गया।',
        ['हर डिज़ाइन पर वोट, साइज़ के साथ', 'होल्ड रकम जो बाद में दाम से घटे', 'सबसे पसंद डिज़ाइन एक टैप में सेल पर'], 'पूछना कैसे काम करता है'],
    ],
    dayEyebrow: 'आपका दिन', dayH: 'NukkadSale से पहले और बाद', dayCols: ['काम', 'आज', 'NukkadSale के साथ'],
    day: [
      ['ऑर्डर लेना', '50 DM में “Price?” “Size?”', 'ग्राहक आपके लिंक से ऑर्डर करें'],
      ['आख़िरी पीस', 'तीन लोगों से वादा', 'पहले ग्राहक के लिए होल्ड, बाकी वेटलिस्ट में'],
      ['पेमेंट', 'स्क्रीनशॉट ढूँढते रहना', 'सही रकम से पता चले किसने भेजा'],
      ['डिलीवरी', 'कूरियर को फ़ोन, हर पता हाथ से', 'सबसे अच्छा रेट बुक, लेबल प्रिंट'],
      ['हिसाब', 'महीने के आख़िर में कॉपी और Excel', 'खाता और मुनाफ़ा, पहले से तैयार'],
    ],
    whoEyebrow: 'किसके लिए', whoH: 'आप जैसे सेलर के लिए बना', whoP: 'अगर आप WhatsApp ग्रुप, स्टेटस या Instagram DM से बेचते हैं, तो NukkadSale आपके लिए है।',
    who: [['shop', 'बुटीक और कपड़े', 'कुर्ती, साड़ी, सूट, बच्चों के कपड़े'], ['tag', 'ज्वेलरी और एक्सेसरी', 'झुमके, बैग, घड़ी, परफ़्यूम'], ['bag', 'घर का खाना और बेकरी', 'अचार, केक, मिठाई, नमकीन'], ['users', 'रीसेलर और होलसेलर', 'कई प्रोडक्ट, कई ग्राहक']],
    all: (bot: boolean): [string, string, [string, string][]][] => [
      ['bag', 'ऑर्डर लेना', [
        ['हर प्रोडक्ट का ऑर्डर लिंक', 'ग्रुप और स्टेटस में डालें। ग्राहक सेकंडों में ऑर्डर करें – कोई ऐप, कोई साइन-अप नहीं।'],
        ...(bot ? [['WhatsApp में ही ऑर्डर', 'ग्राहक आपकी पोस्ट पर टैप करें और चैट में ऑर्डर करें। बॉट साइज़ और पता पूछता है।'] as [string, string]] : []),
        ['कार्ट, एक पेमेंट', 'कुर्ती + दुपट्टा + झुमके – एक चेकआउट, चेक करने को एक रकम।'],
        ['चैट से ऑर्डर', 'ग्राहक ने DM किया? चीज़ें चुनें और कुल रकम व पेमेंट लिंक वाला मैसेज भेजें।'],
        ['तय समय पर लॉन्च', 'लॉन्च पहले से बताएं। ग्राहक काउंटडाउन देखें, सेल ठीक समय पर खुले।'],
        ['फ़ोटो, साइज़, लिमिट', '5 तक फ़ोटो, साइज़ या वज़न, और एक ग्राहक कितने ले सकता है।'],
        ['आपका स्टॉक आपके पास', 'ग्राहक को सिर्फ़ “उपलब्ध”, “तेज़ी से बिक रहा” या “ख़त्म” दिखे – गिनती नहीं।'],
      ]],
      ['wallet', 'पैसे पाना', [
        ['हर ऑर्डर की सही रकम', 'हर ऑर्डर के अपने पैसे, तो एक नज़र में पता चले किसने पेमेंट किया।'],
        ['कोई भी UPI ऐप', 'Android पर एक Pay बटन, iPhone पर GPay / PhonePe / Paytm बटन, कंप्यूटर पर QR कोड।'],
        ['एक से ज़्यादा UPI ID', 'दुकान की और अपनी – हर सेल के लिए चुनें पैसा कहाँ आए।'],
        ['कैश ऑन डिलीवरी', 'किसी भी सेल पर COD चालू करें, चाहें तो COD चार्ज के साथ।'],
        ['अपने आप पेमेंट', 'ज़्यादा ऑर्डर? आपके अपने Razorpay खाते से पेमेंट अपने आप पक्का।'],
        ['स्क्रीनशॉट की जाँच', 'ग्राहक स्क्रीनशॉट भेज सकते हैं; साथ में याद दिलाया जाता है कि UPI ऐप में देखें।'],
      ]],
      ['tag', 'ज़्यादा बेचना', [
        ['छूट', 'पेज और ग्रुप पोस्ट दोनों में पुराना दाम कटा हुआ दिखे।'],
        ['एक ग्राहक के लिए ख़ास दाम', 'उनके दाम वाला प्राइवेट लिंक। किसी और को नहीं मिलेगा।'],
        ['“ज़्यादा ख़रीदें, ज़्यादा बचाएं”', 'एक बार सेट करें – हर प्रोडक्ट पर दिखे और अपने आप लगे।'],
        ['स्टॉक वापसी की लिस्ट', 'माल ख़त्म? ग्राहक बताने को कहें। स्टॉक डालें और एक-एक टैप में मैसेज करें।'],
        ['एक टैप में फिर से बेचें', 'फ़ोटो, दाम और साइज़ पहले से भरे मिलें।'],
        ['फ़ोटो के साथ शेयर', 'फ़ोटो और कैप्शन साथ में WhatsApp पर – बिल्कुल आपकी आम पोस्ट जैसे।'],
      ]],
      ['box', 'पैकिंग और डिलीवरी', [
        ['भेजने की लिस्ट', 'पेमेंट → पैक → भेजा → पहुँचा, और ग्राहक हर कदम देखें।'],
        ['पते के लेबल', 'सारे लेबल एक साथ प्रिंट – A4 पर 8, COD रकम के साथ।'],
        ['कूरियर देखें और बुक करें', 'ग्राहक के पिनकोड के लिए रेट और पहुँचने की तारीख़। बुकिंग और पिकअप एक साथ।'],
        ['ग्राहक के लिए ट्रैकिंग', 'उनके ऑर्डर पेज पर हर स्कैन – “पार्सल कहाँ है?” वाले मैसेज कम।'],
        ['डिलीवरी फ़ेल? संभल जाएगा', 'फिर से कोशिश, वापस मंगवाना, दोबारा भेजना या स्टॉक में डालना।'],
        ['डिलीवरी चार्ज आपके हिसाब से', 'हर सेल पर डिलीवरी फ़ीस, आपकी तय रकम से ऊपर मुफ़्त।'],
      ]],
      ['book', 'अपना हिसाब', [
        ['अपने आप भरने वाला खाता', 'हर पेड ऑर्डर जुड़ता है। कैश बिक्री और ख़र्च एक टैप में।'],
        ['बिक्री नहीं, मुनाफ़ा', 'लागत एक बार डालें – हर पीस और पूरे महीने का मुनाफ़ा देखें।'],
        ['CA के लिए Excel', 'पूरा खाता जब चाहें डाउनलोड करें।'],
        ['हफ़्ता एक नज़र में', 'बिक्री का चार्ट, ऑर्डर, औसत ऑर्डर और आने वाला पैसा।'],
        ['अपने ग्राहक पहचानें', 'ख़रीद के हिसाब से लिस्ट, बार-बार आने वाले अलग से, एक टैप में WhatsApp।'],
        ['ब्रॉडकास्ट के लिए नंबर', 'WhatsApp ब्रॉडकास्ट लिस्ट के लिए ग्राहकों के नंबर एक्सपोर्ट करें।'],
      ]],
      ['phone', 'आपके फ़ोन के लिए बना', [
        ['हिंदी + English', 'हर स्क्रीन और ग्राहक का हर मैसेज। एक टैप में बदलें।'],
        ['पढ़कर सुनाता है', 'सुनें दबाएं और स्क्रीन के निर्देश पढ़कर सुनाए जाते हैं।'],
        ['“नया ऑर्डर” अलर्ट', 'ऐप खुला हो तो बोलकर अलर्ट और वाइब्रेशन, बंद हो तो फ़ोन पर नोटिफ़िकेशन।'],
        ['होम पर काम की लिस्ट', '“2 पेमेंट चेक करने हैं · 5 ऑर्डर भेजने हैं” – बस ऊपर से शुरू करें।'],
        ['ऐप की तरह खुलता है', 'Chrome या Safari से होम स्क्रीन पर जोड़ें। कंप्यूटर पर भी चलता है।'],
        ['सिर्फ़ ज़रूरी टूल', 'जो इस्तेमाल न करें, सेटिंग में बंद कर दें।'],
      ]],
    ],
    priceEyebrow: 'क़ीमत', priceH: 'आसान मासिक प्लान। कोई कमीशन नहीं।',
    priceP: 'मुफ़्त शुरू करें। ज़्यादा बिकने पर ही तय मासिक फ़ीस – आपकी बिक्री में से कभी कोई हिस्सा नहीं।',
    plans: [
      { name: 'शुरुआत', price: '₹0', per: 'मुफ़्त', limit: 'महीने में 30 पेड ऑर्डर तक', tag: 'आज़माने के लिए', extra: 'हर फ़ीचर शामिल। शुरू करने के लिए कुछ नहीं देना।', cta: 'मुफ़्त शुरू करें' },
      { name: 'दुकान', price: '₹999', per: '/महीना', limit: 'महीने में 300 पेड ऑर्डर तक', tag: 'नियमित सेलर के लिए', extra: 'हर फ़ीचर, दस गुना ऑर्डर।', cta: 'दुकान चुनें' },
      { name: 'बड़ी दुकान', price: '₹1,999', per: '/महीना', limit: 'अनलिमिटेड ऑर्डर', tag: 'ज़्यादा ऑर्डर वालों के लिए', extra: 'साथ में Razorpay से अपने आप पेमेंट और WhatsApp पर प्राथमिकता से मदद', cta: 'बड़ी दुकान चुनें' },
    ],
    planIncl: 'हर प्लान में', incl: ['दुकान का लिंक और ऑर्डर लिंक', 'सही रकम वाला UPI पेमेंट', 'पेमेंट तक स्टॉक होल्ड', 'खाता और मुनाफ़ा', 'छूट, ख़ास दाम, वेटलिस्ट', 'पते के लेबल और कूरियर बुकिंग', 'ग्राहकों की लिस्ट', 'हिंदी + English'],
    priceNote: 'बिक्री पर कोई कमीशन नहीं – पैसा सीधे आपकी UPI ID या आपके अपने Razorpay खाते में (Razorpay अपनी फ़ीस लेता है)। हर प्लान में दुकान हम आपके साथ सेट करते हैं।',
    faqEyebrow: 'सवाल', faqH: 'सेलर अक्सर पूछते हैं',
    faq: (bot: boolean) => [
      ['NukkadSale असल में है क्या?', 'WhatsApp और Instagram पर बेचने वालों का ऐप। यह ऑर्डर लेता है, पैसे सीधे आपकी UPI में लेता है (और बताता है किसने भेजा), कूरियर बुक करता है और खाता रखता है। यह शॉपिंग साइट या मार्केटप्लेस नहीं है – आपके ग्राहक आपके ही रहते हैं।'],
      ['क्या ग्राहकों को कुछ इंस्टॉल करना होगा?', bot ? 'नहीं। वो WhatsApp में ही ऑर्डर करें, या किसी भी ब्राउज़र में आपके लिंक से।' : 'नहीं। वो किसी भी ब्राउज़र में आपका लिंक खोलें, साइज़ चुनें और पेमेंट करें। कोई ऐप नहीं, कोई साइन-अप नहीं।'],
      ['क्या ग्राहक लिंक पर भरोसा करेंगे?', 'उन्हें आपकी दुकान का नाम, आपका असली WhatsApp नंबर और पुराने ग्राहकों के रिव्यू दिखते हैं। ऑर्डर के बाद हर कदम की टाइमलाइन – पैक पार्सल की फ़ोटो के साथ – और असली पेमेंट रसीद मिलती है।'],
      ['क्या मेरा पैसा सुरक्षित है?', 'NukkadSale आपका पैसा कभी नहीं रखता। ग्राहक सीधे आपकी UPI ID पर भेजते हैं, या अपने आप पेमेंट में आपके अपने Razorpay खाते में।'],
      ['क्या कूरियर खाता ज़रूरी है?', 'नहीं। पार्सल जैसे चाहें भेजें और पते के लेबल NukkadSale से प्रिंट करें। कूरियर खाता है तो जोड़ें – रेट देखें, पिकअप बुक करें और ट्रैकिंग भेजें।'],
      ['क्या हिंदी में चलेगा?', 'हाँ। हर स्क्रीन और जो भी आपके ग्राहक देखते हैं, हिंदी और English दोनों में।'],
      ['शुरू कैसे करें?', 'नीचे छोटा फ़ॉर्म भरें। हम WhatsApp पर मैसेज करेंगे, आपके साथ दुकान सेट करेंगे और लॉग इन भेजेंगे। ज़्यादातर सेलर उसी दिन पहला प्रोडक्ट डाल देते हैं।'],
      ['इसका ख़र्च कितना है?', 'शुरुआत प्लान महीने में 30 पेड ऑर्डर तक मुफ़्त है। दुकान ₹999 महीना (300 ऑर्डर तक) और बड़ी दुकान ₹1,999 महीना (अनलिमिटेड ऑर्डर)। बिक्री पर कोई कमीशन नहीं।'],
    ],
    menu: 'मेन्यू', swipe: 'चारों कदम देखने के लिए स्वाइप करें →', stickyCta: 'शुरुआत मुफ़्त। सेट-अप हम करेंगे।',
    featNav: 'क्या करता है', allJobs: 'चारों काम', backHome: '← होम', featGet: 'आपको क्या मिलता है', featSteps: 'कैसे काम करता है', featMore: 'बाकी काम देखें', featCtaH: 'आज़माना चाहेंगे?', featCtaP: 'शुरुआत मुफ़्त। WhatsApp पर हम आपके साथ दुकान सेट करेंगे।',
    formEyebrow: 'शुरू करें', formH: 'अपनी दुकान पाएं', formP: 'अपना नाम और WhatsApp नंबर दें। हम मैसेज करेंगे, आपके साथ दुकान सेट करेंगे और लॉग इन भेजेंगे।',
    f: { more: 'अपने काम के बारे में और बताएं (ज़रूरी नहीं)', name: 'आपका नाम', business: 'दुकान / बिज़नेस का नाम', phone: 'WhatsApp नंबर', city: 'शहर', sells: 'आप क्या बेचते हैं?', sellsPh: 'जैसे कुर्ती, साड़ी, ज्वेलरी', channel: 'अभी कहाँ बेचते हैं?', volume: 'महीने में कितने ऑर्डर?', payments: 'पैसे कैसे लेना चाहेंगे?', message: 'कुछ और? (ज़रूरी नहीं)', choose: 'चुनें…', submit: 'कॉल बैक माँगें', consent: 'भेजकर आप NukkadSale के बारे में WhatsApp या फ़ोन पर संपर्क के लिए सहमत हैं। देखें हमारी', privacy: 'प्राइवेसी पॉलिसी' },
    errs: { fill: 'कृपया नाम, बिज़नेस का नाम और WhatsApp नंबर भरें।', phone: 'कृपया सही 10 अंकों का मोबाइल नंबर डालें।', many: 'आज इस फ़ोन से बहुत सारे फ़ॉर्म आ चुके। कृपया WhatsApp पर मैसेज करें।' },
    thanksH: 'धन्यवाद!', thanksP: (p: string) => `आपकी जानकारी मिल गई। दुकान सेट करने के लिए हम जल्द ही ${p} पर WhatsApp करेंगे।`, thanksWa: 'अभी WhatsApp पर मैसेज करें', back: '← होम पर वापस',
    footer: 'WhatsApp पर बेचने वालों का ऐप।', policies: [['/privacy', 'प्राइवेसी'], ['/terms', 'शर्तें'], ['/refunds', 'रिफ़ंड'], ['/contact', 'संपर्क']],
  },
}
type Copy = (typeof C)['en'] | (typeof C)['hi']

/** The five "what it does" pages: /features/<slug>. Items come from the "all" lists (group index). */
const FEATURES = {
  orders: { icon: 'bag', group: 0, clip: 'orders', imgs: ['storefront', 'buyer-sale'],
    en: { name: 'Orders & stock', h1: 'Buyers order themselves. You stop typing prices.', sub: 'Share one link in your WhatsApp groups. Buyers see the photos, pick a size and order – and the piece is held for them while they pay, so it is never sold twice.',
      steps: ['Add a product: photo, price, sizes and how many you have.', 'Share the ready-made WhatsApp message in your groups and status.', 'Orders arrive in the app with name, size and address.'] },
    hi: { name: 'ऑर्डर और स्टॉक', h1: 'ग्राहक ख़ुद ऑर्डर करें। आप दाम लिखना बंद करें।', sub: 'WhatsApp ग्रुप में एक लिंक शेयर करें। ग्राहक फ़ोटो देखें, साइज़ चुनें और ऑर्डर करें – पेमेंट तक पीस उनके लिए होल्ड रहता है, तो दो बार नहीं बिकता।',
      steps: ['प्रोडक्ट डालें: फ़ोटो, दाम, साइज़ और कितने हैं।', 'तैयार WhatsApp मैसेज ग्रुप और स्टेटस में शेयर करें।', 'ऑर्डर नाम, साइज़ और पते के साथ ऐप में आते हैं।'] } },
  payments: { icon: 'wallet', group: 1, clip: 'payments', imgs: ['orders-check', 'buyer-pay'],
    en: { name: 'Payments', h1: 'Paid straight to your UPI. You see who paid.', sub: 'Every order gets its own exact amount – like ₹798.52 for a ₹799 kurta. When that amount shows in your UPI app, you know whose order it is. Tap “Yes, I got it”. No screenshots.',
      steps: ['The buyer pays your UPI ID from any UPI app.', 'The app asks: “Did you get ₹798.52?”', 'Check your UPI app and tap Yes. Or switch on automatic payments and skip even that.'] },
    hi: { name: 'पेमेंट', h1: 'पैसा सीधे आपकी UPI में। पता चले किसने भेजा।', sub: 'हर ऑर्डर की अपनी सही रकम – जैसे ₹799 की कुर्ती के लिए ₹798.52। UPI ऐप में वो रकम दिखी तो पता चल गया किसका ऑर्डर है। “हाँ, पैसे आ गए” टैप करें। स्क्रीनशॉट नहीं।',
      steps: ['ग्राहक किसी भी UPI ऐप से आपकी UPI ID पर भेजे।', 'ऐप पूछता है: “क्या ₹798.52 आए?”', 'UPI ऐप देखें और हाँ टैप करें। या अपने आप पेमेंट चालू करें, वो भी नहीं करना।'] } },
  delivery: { icon: 'box', group: 3, clip: 'delivery', imgs: ['ship-book', 'track'],
    en: { name: 'Delivery', h1: 'Book the courier in a tap. Buyers track it.', sub: 'See courier rates and delivery dates for the buyer’s pincode, book the cheapest or the fastest, schedule the pickup and print the label – right from the order. Prefer your local courier? Print labels for every parcel at once.',
      steps: ['Open a paid order and see courier prices for that pincode.', 'Book, print the label and schedule the pickup.', 'The buyer’s order page shows every scan until it is delivered.'] },
    hi: { name: 'डिलीवरी', h1: 'एक टैप में कूरियर बुक। ग्राहक ख़ुद ट्रैक करें।', sub: 'ग्राहक के पिनकोड के लिए कूरियर रेट और पहुँचने की तारीख़ देखें, सबसे सस्ता या सबसे तेज़ बुक करें, पिकअप तय करें और लेबल प्रिंट करें – ऑर्डर से ही। लोकल कूरियर पसंद है? सारे लेबल एक साथ प्रिंट करें।',
      steps: ['पेड ऑर्डर खोलें और उस पिनकोड के कूरियर रेट देखें।', 'बुक करें, लेबल प्रिंट करें, पिकअप तय करें।', 'पहुँचने तक ग्राहक के ऑर्डर पेज पर हर स्कैन।'] } },
  accounts: { icon: 'book', group: 4, clip: 'accounts', imgs: ['profit', 'home'],
    en: { name: 'Accounts', h1: 'Your khata writes itself. With profit.', sub: 'Every paid order is added for you. Add a piece’s cost once and see profit per piece and for the month. Know your best buyers. Download it all for your CA.',
      steps: ['Sell as usual – every paid order lands in the khata.', 'Add cash sales and expenses with one tap.', 'See today, this month and your profit at a glance.'] },
    hi: { name: 'हिसाब', h1: 'खाता अपने आप लिखा जाता है। मुनाफ़े के साथ।', sub: 'हर पेड ऑर्डर अपने आप जुड़ता है। एक बार लागत डालें और हर पीस व महीने का मुनाफ़ा देखें। अपने सबसे अच्छे ग्राहक जानें। CA के लिए सब डाउनलोड करें।',
      steps: ['आम तरह बेचें – हर पेड ऑर्डर खाते में।', 'कैश बिक्री और ख़र्च एक टैप में जोड़ें।', 'आज, इस महीने और मुनाफ़ा एक नज़र में।'] } },
  buyers: { icon: 'lock', group: 3, clip: '', imgs: ['t-timeline', 't-receipt'],
    en: { name: 'For your buyers', h1: 'Your buyers get what big online shops give.', sub: 'Buyers who trust your link pay faster and come back. Every order on NukkadSale comes with a timeline, a receipt, size help and reviews – and cash on delivery can start with a small advance.',
      steps: ['The buyer orders from your link and pays you directly.', 'They follow every step: paid, packed (with your photo), sent, delivered – and get a receipt.', 'After delivery they review it, and the next buyer sees real reviews on your shop.'],
      items: [['Order timeline', 'From “Order placed” to “Delivered”, with the time of each step and the courier’s tracking.'], ['Packed-parcel photo', 'Snap the parcel when you tap “Mark as packed” – the buyer sees it on their order.'], ['Payment receipt', 'Shop, items, total, how it was paid. Save as PDF, print or share on WhatsApp.'], ['Size chart', 'Upload it once in Settings and show it on the sales you choose.'], ['“Ask my size”', 'One tap opens WhatsApp to you with the product name ready. Their size is remembered for next time.'], ['Reviews with photos', 'After delivery only, first name only. Hide any review, or switch them all off.'], ['Advance on cash on delivery', 'Ask for, say, ₹100 by UPI first. The order is confirmed only once you see it; the rest is paid in cash.'], ['Proof for you', 'Every step has a time on it – useful when a buyer says “not received”.']] },
    hi: { name: 'आपके ग्राहकों के लिए', h1: 'आपके ग्राहकों को वो मिलता है जो बड़ी ऑनलाइन दुकानें देती हैं।', sub: 'जिन ग्राहकों को आपके लिंक पर भरोसा है, वो जल्दी पेमेंट करते हैं और लौटते हैं। NukkadSale पर हर ऑर्डर के साथ टाइमलाइन, रसीद, साइज़ मदद और रिव्यू – और कैश ऑन डिलीवरी थोड़े एडवांस से शुरू हो सकता है।',
      steps: ['ग्राहक आपके लिंक से ऑर्डर करे और सीधे आपको पेमेंट करे।', 'हर कदम देखे: पेमेंट, पैक (आपकी फ़ोटो के साथ), भेजा, पहुँचा – और रसीद पाए।', 'डिलीवरी के बाद रिव्यू दे, और अगला ग्राहक आपकी दुकान पर असली रिव्यू देखे।'],
      items: [['ऑर्डर टाइमलाइन', '“ऑर्डर किया” से “पहुँच गया” तक, हर कदम के समय और कूरियर ट्रैकिंग के साथ।'], ['पैक पार्सल की फ़ोटो', '“पैक हुआ” दबाते समय फ़ोटो लें – ग्राहक अपने ऑर्डर पर देखे।'], ['पेमेंट रसीद', 'दुकान, सामान, कुल रकम, कैसे भुगतान हुआ। PDF सेव, प्रिंट या WhatsApp पर शेयर।'], ['साइज़ चार्ट', 'सेटिंग में एक बार डालें और चुनी हुई सेल पर दिखाएं।'], ['“मेरा साइज़ पूछें”', 'एक टैप में WhatsApp पर आपसे पूछें, प्रोडक्ट का नाम पहले से लिखा। अगली बार के लिए साइज़ याद।'], ['फ़ोटो वाले रिव्यू', 'सिर्फ़ डिलीवरी के बाद, सिर्फ़ पहला नाम। कोई भी रिव्यू छुपाएं, या सब बंद करें।'], ['कैश ऑन डिलीवरी पर एडवांस', 'पहले, जैसे ₹100, UPI से माँगें। आपके देखने पर ही ऑर्डर पक्का; बाकी कैश में।'], ['आपके लिए सबूत', 'हर कदम पर समय दर्ज – जब ग्राहक कहे “नहीं मिला” तब काम आता है।']] } },
  live: { icon: 'bell', group: 2, clip: '', imgs: ['live', 'soon'],
    en: { name: 'Live drops', h1: 'Make every sale an event.', sub: 'Announce a time in your groups. Buyers get a countdown and can ask to be reminded. When it opens, everyone sees the pieces running out and who just bought – and you see the whole group turn up.',
      steps: ['Add a product, tick “Live drop” and pick a start time.', 'Share it – buyers see a countdown and tap “Remind me”. When it opens, you message them in one tap.', 'Buyers watch stock fall live: “Only 4 left!”, “Pooja just bought one”, then “Sold out in 12 minutes”.'],
      items: [['Countdown to the start', 'The sale page counts down and opens on the minute.'], ['“Remind me when it starts”', 'Buyers leave their number; when it opens, your app lists them with a ready WhatsApp message.'], ['Pieces left, live', '“Only 4 left!” and a bar that fills as it sells – updated every few seconds.'], ['Who just bought', 'First name and size only – never surnames or numbers.'], ['“Sold out in 12 minutes”', 'Shown on the page once it is gone – proof for the next drop.'], ['Your choice', 'Turn it on or off for any sale. Other sales still never show stock numbers.']] },
    hi: { name: 'लाइव ड्रॉप', h1: 'हर सेल को इवेंट बनाएं।', sub: 'ग्रुप में समय बताएं। ग्राहकों को काउंटडाउन दिखे और वो याद दिलाने को कह सकें। खुलते ही सब देखें पीस ख़त्म होते और किसने अभी लिया – और आप देखें पूरा ग्रुप आ गया।',
      steps: ['प्रोडक्ट डालें, “लाइव ड्रॉप” चुनें और शुरू होने का समय डालें।', 'शेयर करें – ग्राहक काउंटडाउन देखें और “याद दिलाएं” दबाएं। खुलते ही एक टैप में मैसेज करें।', 'ग्राहक लाइव देखें स्टॉक घटते: “सिर्फ़ 4 बचे!”, “पूजा ने अभी एक लिया”, फिर “12 मिनट में सब बिक गया”।'],
      items: [['शुरू होने तक काउंटडाउन', 'सेल पेज पर उल्टी गिनती, ठीक समय पर खुलता है।'], ['“शुरू होने पर याद दिलाएं”', 'ग्राहक नंबर छोड़ें; खुलते ही आपके ऐप में तैयार WhatsApp मैसेज के साथ लिस्ट।'], ['कितने बचे, लाइव', '“सिर्फ़ 4 बचे!” और बिकने के साथ भरती पट्टी – हर कुछ सेकंड में अपडेट।'], ['किसने अभी लिया', 'सिर्फ़ पहला नाम और साइज़ – कभी सरनेम या नंबर नहीं।'], ['“12 मिनट में सब बिक गया”', 'ख़त्म होने पर पेज पर दिखे – अगले ड्रॉप के लिए सबूत।'], ['आपकी मर्ज़ी', 'किसी भी सेल पर चालू या बंद करें। बाकी सेल में स्टॉक की गिनती कभी नहीं दिखती।']] } },
  ask: { icon: 'users', group: 2, clip: '', imgs: ['ask', 'askres'],
    en: { name: 'Ask your buyers', h1: 'Know what sells before you buy stock.', sub: 'Show buyers the designs from your supplier first. They tap the ones they want – with their size – and can pay a small reserve to hold their pick. You order only what will sell.',
      steps: ['Add 2 to 6 designs with a photo and price, and an optional reserve like ₹50.', 'Share the link in your groups. Buyers pick, and reserve if they really want it.', 'See the most wanted, tap “Make it a sale”, and tell every buyer in one tap – reserves come off their price.'],
      items: [['Votes on each design', 'See exactly how many want each one, and which sizes.'], ['A reserve that holds the pick', 'Buyers pay it to your UPI with an exact amount, so you know who paid.'], ['Comes off the price', 'When the design goes on sale, each reserve becomes that buyer’s own price link.'], ['One tap to a sale', 'Photo, name and price are filled in – stock starts at how many want it.'], ['Tell every buyer', 'A ready WhatsApp message for each buyer who picked it.'], ['Close any time', 'Voting closes on the day you choose, or when you say.']] },
    hi: { name: 'ग्राहकों से पूछें', h1: 'स्टॉक लेने से पहले जानें क्या बिकेगा।', sub: 'सप्लायर के डिज़ाइन पहले ग्राहकों को दिखाएं। जो चाहिए उन पर टैप करें – साइज़ के साथ – और पसंद होल्ड करने के लिए थोड़ी रकम दें। आप वही मंगाएं जो बिकेगा।',
      steps: ['फ़ोटो और दाम के साथ 2 से 6 डिज़ाइन डालें, चाहें तो ₹50 जैसी होल्ड रकम।', 'लिंक ग्रुप में शेयर करें। ग्राहक चुनें, और सच में चाहिए तो होल्ड करें।', 'सबसे पसंद देखें, “इसकी सेल बनाएं” दबाएं, और एक टैप में सबको बताएं – होल्ड रकम उनके दाम से घटती है।'],
      items: [['हर डिज़ाइन पर वोट', 'देखें हर एक को कितने लोग चाहते हैं, और कौन से साइज़।'], ['पसंद होल्ड करने की रकम', 'ग्राहक सही रकम आपकी UPI पर भेजें, तो पता रहे किसने भेजा।'], ['दाम से घटती है', 'डिज़ाइन सेल पर आते ही हर होल्ड उस ग्राहक का अपना दाम वाला लिंक बन जाती है।'], ['एक टैप में सेल', 'फ़ोटो, नाम और दाम पहले से भरे – स्टॉक उतना जितने लोग चाहते हैं।'], ['सबको बताएं', 'चुनने वाले हर ग्राहक के लिए तैयार WhatsApp मैसेज।'], ['कभी भी बंद करें', 'वोटिंग आपके चुने दिन बंद हो, या जब आप कहें।']] } },
  grow: { icon: 'tag', group: 2, clip: '', imgs: ['discount', 'waitlist'],
    en: { name: 'Selling tools', h1: 'Tools that bring buyers back.', sub: 'Run a discount, give one buyer a special price, tell buyers when stock is back, count down to a launch and reward bigger carts – all built in, all optional.',
      steps: ['Open any sale and pick a tool.', 'NukkadSale makes the WhatsApp message for it.', 'Buyers see it on your shop and order.'] },
    hi: { name: 'बेचने के टूल', h1: 'ग्राहक बार-बार लौटें, इसके टूल।', sub: 'छूट चलाएं, एक ग्राहक को ख़ास दाम दें, स्टॉक लौटने पर बताएं, लॉन्च का काउंटडाउन दिखाएं और बड़े कार्ट पर छूट दें – सब पहले से मौजूद, सब ज़रूरत के हिसाब से।',
      steps: ['कोई भी सेल खोलें और टूल चुनें।', 'NukkadSale उसका WhatsApp मैसेज बना देता है।', 'ग्राहक आपकी दुकान पर देखें और ऑर्डर करें।'] } },
} as const
type Slug = keyof typeof FEATURES
// Screens captured in both languages (public/site/<name>-en.webp, -hi.webp).
const LANG_IMGS = new Set(['live', 'soon', 'ask', 'askres', 't-timeline', 't-receipt', 't-size', 't-reviews', 't-advance'])
const SLUGS = Object.keys(FEATURES) as Slug[]

const CSS = `
:root{--bg:#fffaf5;--ink:#1d1a16;--muted:#6b6258;--brand:#e2560c;--brand2:#f76707;--deep:#b83f0d;--soft:#fff1e8;--line:#efe2d4;--card:#fff;--green:#1f8a4c;color-scheme:light}
*{box-sizing:border-box;margin:0}
html{scroll-behavior:smooth}
body{font-family:system-ui,-apple-system,"Segoe UI",Roboto,"Noto Sans","Noto Sans Devanagari",sans-serif;background:var(--bg);color:var(--ink);line-height:1.55;-webkit-font-smoothing:antialiased}
a{color:inherit}
img{max-width:100%;height:auto;display:block}
.wrap{max-width:1120px;margin:0 auto;padding:0 20px}
.btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;min-height:48px;padding:0 22px;border-radius:14px;font-weight:800;font-size:1rem;text-decoration:none;border:2px solid transparent;cursor:pointer;font-family:inherit}
.btn.primary{background:var(--brand);color:#fff;box-shadow:0 10px 24px rgba(226,86,12,.28)}
.btn.primary:hover{background:var(--deep)}
.btn.ghost{border-color:var(--line);background:#fff}
.btn.sm{min-height:40px;padding:0 16px;font-size:.92rem;border-radius:12px}
header{position:sticky;top:0;z-index:20;background:rgba(255,250,245,.88);backdrop-filter:blur(10px);border-bottom:1px solid var(--line)}
header .wrap{display:flex;align-items:center;gap:16px;height:64px}
.logo{display:flex;align-items:center;gap:8px;font-weight:900;font-size:1.25rem;text-decoration:none;letter-spacing:-.3px}
.logo i{width:34px;height:34px;border-radius:10px;background:linear-gradient(145deg,var(--brand2),var(--brand));display:flex;align-items:center;justify-content:center}
nav.links{display:flex;gap:22px;margin-left:24px}
nav.links a{text-decoration:none;font-weight:600;color:var(--muted);white-space:nowrap}
@media (max-width:1100px){nav.links{gap:16px;margin-left:8px}}@media (max-width:980px){nav.links{display:none}}
nav.links a:hover{color:var(--ink)}
.hgap{flex:1}
.lang{font-weight:700;text-decoration:none;color:var(--muted);font-size:.95rem;display:inline-flex;align-items:center;min-height:40px}
.login{font-weight:700;text-decoration:none;font-size:.95rem;display:inline-flex;align-items:center;min-height:40px;white-space:nowrap}.login .short,header .btn .short{display:none}
section{padding:72px 0}
.eyebrow{display:inline-block;font-weight:800;font-size:.85rem;letter-spacing:.06em;text-transform:uppercase;color:var(--brand);margin-bottom:10px}
h1{font-size:clamp(2.3rem,6vw,4rem);line-height:1.04;letter-spacing:-1.5px;font-weight:900}
h2{font-size:clamp(1.8rem,4vw,2.6rem);line-height:1.1;letter-spacing:-1px;font-weight:900;margin-bottom:14px}
h3{font-size:1.15rem;font-weight:800;margin-bottom:6px}
.lead{font-size:1.15rem;color:var(--muted);max-width:620px}
.center{text-align:center}.center .lead{margin:0 auto}
.hero{padding:56px 0 40px;background:radial-gradient(circle at 85% 10%,#ffe3cf,transparent 45%),radial-gradient(circle at 5% 90%,#fff0e2,transparent 40%)}
.hero .wrap{display:grid;grid-template-columns:1.1fr .9fr;gap:40px;align-items:center}
.hero h1{font-size:clamp(2.3rem,5.4vw,3.6rem)}.hero h1 span{color:var(--brand)}
.hero .lead{margin:18px 0 26px}
.ctas{display:flex;gap:12px;flex-wrap:wrap}
.heronote{margin-top:10px;color:var(--muted);font-size:.93rem;font-weight:600}
.trust{display:flex;gap:18px;flex-wrap:wrap;margin-top:22px;color:var(--muted);font-weight:600;font-size:.93rem}
.trust span:before{content:"✓ ";color:var(--green);font-weight:900}
.phones{position:relative;height:560px}
.phone{position:absolute;width:250px;border-radius:38px;background:#1d1a16;padding:9px;box-shadow:0 30px 70px rgba(80,40,10,.28)}
.phone img{border-radius:30px;width:100%}
.phones .p1{left:6%;top:30px;transform:rotate(-5deg)}
.phones .p2{right:4%;top:0;transform:rotate(5deg)}
.dark{background:#16130f;color:#fff}
.dark .lead{color:#c9bfb3}
.pain .wrap{display:grid;grid-template-columns:1fr 1fr;gap:40px;align-items:center}
.dms{display:flex;flex-wrap:wrap;gap:10px}
.dm{background:#fff;color:#1d1a16;font-weight:800;padding:10px 16px;border-radius:18px 18px 18px 6px;box-shadow:0 8px 20px rgba(0,0,0,.3)}
.dm:nth-child(even){border-radius:18px 18px 6px 18px;background:#dcf8c6}
.badge{display:inline-block;background:#e03131;color:#fff;font-weight:900;padding:6px 14px;border-radius:99px;margin-bottom:14px}
.pains{list-style:none;padding:0;margin-top:20px;display:grid;gap:12px}
.pains li{display:flex;gap:12px;align-items:center;font-weight:700;font-size:1.05rem}
.pains li:before{content:"✗";flex:none;width:30px;height:30px;border-radius:50%;background:#e03131;display:flex;align-items:center;justify-content:center;font-weight:900}
.steps{display:grid;grid-template-columns:repeat(4,1fr);gap:22px;margin-top:40px}
.step{background:var(--card);border:1px solid var(--line);border-radius:24px;padding:20px;display:flex;flex-direction:column}
.step .n{width:36px;height:36px;border-radius:50%;background:var(--brand);color:#fff;font-weight:900;display:flex;align-items:center;justify-content:center;margin-bottom:12px}
.step p{color:var(--muted);font-size:.95rem;margin-bottom:16px}
.step .shot{margin-top:auto;border-radius:20px;overflow:hidden;border:6px solid #1d1a16;aspect-ratio:9/13}
.step .shot img{width:100%;height:100%;object-fit:cover;object-position:top}
.paise .wrap{display:grid;grid-template-columns:1fr 1fr;gap:40px;align-items:center}
.big{font-size:clamp(3rem,8vw,5.5rem);font-weight:900;letter-spacing:-3px;line-height:1}
.big span{color:#ffd43b}
.cards{margin:0;max-width:400px;justify-self:center}
.cards img{border-radius:22px;background:#faf7f2;box-shadow:0 24px 60px rgba(0,0,0,.35)}
.cards figcaption{margin-top:12px;font-size:.9rem;color:#d3eedc;text-align:center}
.green{background:linear-gradient(170deg,#1f7a4a,#0f4d2e);color:#fff}
.green .lead{color:#d3eedc}
.grid{display:grid;grid-template-columns:repeat(4,1fr);gap:18px;margin-top:36px}
.pay{display:grid;grid-template-columns:1fr 1fr;gap:22px;margin-top:36px;max-width:860px;margin-left:auto;margin-right:auto}
.paycard{background:#fff;border:1px solid var(--line);border-radius:24px;padding:28px}
.paycard .ic{color:var(--brand)}
.paycard ul{list-style:none;padding:0;margin:14px 0;display:grid;gap:8px;color:var(--muted)}
.paycard li:before{content:"✓ ";color:var(--green);font-weight:900}
.tag{display:inline-block;background:var(--soft);color:var(--deep);font-weight:800;font-size:.85rem;padding:6px 12px;border-radius:99px}
.note{margin-top:22px;color:var(--muted);font-weight:600}
.hindi .wrap{display:grid;grid-template-columns:1fr 1fr;gap:40px;align-items:center}
.duo{display:flex;gap:18px;justify-content:center}
.duo .phone{position:relative;width:220px}
.duo .phone:first-child{transform:rotate(-4deg)}.duo .phone:last-child{transform:rotate(4deg);margin-top:30px}
.onb{display:grid;grid-template-columns:repeat(3,1fr);gap:22px;margin-top:36px}
.onb div{background:#fff;border:1px solid var(--line);border-radius:22px;padding:24px}
.onb b{display:inline-flex;width:40px;height:40px;border-radius:50%;background:var(--brand);color:#fff;align-items:center;justify-content:center;margin-bottom:12px;font-size:1.1rem}
.onb p{color:var(--muted)}
.faq{max-width:780px;margin:30px auto 0;display:grid;gap:12px}
details{background:#fff;border:1px solid var(--line);border-radius:18px}
summary{font-weight:800;cursor:pointer;list-style:none;display:flex;justify-content:space-between;align-items:center;gap:12px;padding:18px 22px;min-height:48px}
summary::-webkit-details-marker{display:none}
summary:after{content:"+";font-size:1.4rem;line-height:1;color:var(--brand)}
details[open] summary:after{content:"–"}
details p{color:var(--muted);padding:0 22px 18px}
.formsec{background:linear-gradient(160deg,var(--brand2),var(--brand) 60%,var(--deep));color:#fff}
.formsec .wrap{display:grid;grid-template-columns:.9fr 1.1fr;gap:40px;align-items:start}
.formsec .lead{color:#ffe8d9}
form.card{background:#fff;color:var(--ink);border-radius:26px;padding:28px;box-shadow:0 30px 70px rgba(80,25,0,.3);display:grid;gap:14px}
.fields{display:grid;grid-template-columns:1fr 1fr;gap:14px}
label{display:block;font-weight:700;font-size:.92rem;margin-bottom:6px}
input,select,textarea{width:100%;font:inherit;font-size:1rem;padding:12px 14px;border:2px solid var(--line);border-radius:12px;background:#fff;color:var(--ink)}
input:focus,select:focus,textarea:focus{outline:none;border-color:var(--brand)}
textarea{min-height:84px;resize:vertical}
.tel{display:flex;align-items:stretch}
.tel span{display:flex;align-items:center;padding:0 12px;border:2px solid var(--line);border-right:0;border-radius:12px 0 0 12px;background:var(--soft);font-weight:700}
.tel input{border-radius:0 12px 12px 0}
.consent{font-size:.82rem;color:var(--muted)}
.err{background:#fdeaea;color:#a51d1d;border-radius:12px;padding:12px 14px;font-weight:700}
.hp{position:absolute;left:-9999px;width:1px;height:1px;overflow:hidden}
footer{padding:40px 0;border-top:1px solid var(--line);color:var(--muted)}
footer .wrap{display:flex;justify-content:space-between;gap:20px;flex-wrap:wrap;align-items:center}
footer nav{display:flex;gap:18px;flex-wrap:wrap}
footer a{text-decoration:none;font-weight:600;display:inline-block;padding:10px 2px}
.thanks{min-height:70vh;display:flex;align-items:center}
.thanks .box{max-width:560px;margin:0 auto;text-align:center;background:#fff;border:1px solid var(--line);border-radius:28px;padding:40px 28px}
.thanks p{color:var(--muted);margin:14px 0 24px;font-size:1.1rem}
.split .wrap{display:grid;grid-template-columns:1.05fr .95fr;gap:56px;align-items:center}
.split.rev .wrap{grid-template-columns:.95fr 1.05fr}
.ticks{list-style:none;padding:0;margin:26px 0 0;display:grid;gap:18px}
.ticks.two{grid-template-columns:1fr 1fr;gap:20px 24px}
.ticks li{display:grid;grid-template-columns:44px 1fr;gap:14px;align-items:start}
.ticks .ic{width:44px;height:44px;border-radius:12px;background:var(--soft);color:var(--brand);display:flex;align-items:center;justify-content:center}
.ticks b{display:block;font-size:1.02rem;margin-bottom:2px}.ticks span:not(.ic){color:var(--muted);font-size:.95rem}
.pair{display:flex;gap:5%;justify-content:center;align-items:flex-start;padding-bottom:20px}
.pair .phone{position:relative;width:47%;max-width:250px}.pair .b{margin-top:60px}
/* What you get */
.what{background:#fff;border-bottom:1px solid var(--line)}
.gets{display:grid;grid-template-columns:repeat(4,1fr);gap:18px;margin-top:40px}
.get{background:var(--bg);border:1px solid var(--line);border-radius:24px;padding:22px 20px 0;display:flex;flex-direction:column;overflow:hidden}
.get .ic{width:46px;height:46px;border-radius:14px;background:var(--soft);color:var(--brand);display:flex;align-items:center;justify-content:center;margin-bottom:12px}
.get p{color:var(--muted);font-size:.95rem;margin-bottom:18px}
.get .crop{margin-top:auto;height:260px;border-radius:20px 20px 0 0;overflow:hidden;border:6px solid #1d1a16;border-bottom:0}
.get .crop img{width:100%;height:100%;object-fit:cover;object-position:top}
.nots{margin-top:28px;border:1px solid var(--line);border-radius:22px;padding:22px 24px;display:grid;grid-template-columns:200px 1fr;gap:20px;align-items:center}
.nots h3{margin:0}
.nots ul{list-style:none;padding:0;display:grid;grid-template-columns:repeat(3,1fr);gap:20px}
.nots b{display:block;margin-bottom:2px}.nots span{color:var(--muted);font-size:.93rem}
.nots li{padding-left:16px;border-left:3px solid var(--brand)}
details.more{padding:0;border:0;background:none}
details.more summary{font-weight:700;color:var(--deep);font-size:.95rem;justify-content:flex-start;gap:8px;padding:8px 0;min-height:40px}
details.more summary:after{content:"+"}details.more[open] summary:after{content:"–"}
.allf{background:#fff;border-top:1px solid var(--line)}
.fgroups{display:grid;grid-template-columns:repeat(3,1fr);gap:20px;margin-top:40px}
.fgroup{background:var(--bg);border:1px solid var(--line);border-radius:24px;padding:24px 22px}
details.fgroup{background:var(--bg);border-radius:24px}
summary.fhead{display:flex;align-items:center;justify-content:flex-start;gap:12px;padding:0;min-height:0;cursor:default}
summary.fhead:after{content:none}.fhead h3{margin:0}.fcount{display:none}
details.fgroup[open] summary.fhead{margin-bottom:14px}
.fhead .ic{width:44px;height:44px;border-radius:12px;background:var(--soft);color:var(--brand);display:flex;align-items:center;justify-content:center;flex:none}
.fgroup ul{list-style:none;padding:0;display:grid;gap:12px}
.fgroup li{padding-left:16px;border-left:2px solid var(--line)}
.fgroup li b{display:block;font-size:.98rem;margin-bottom:1px}.fgroup li span{color:var(--muted);font-size:.9rem;line-height:1.45}
.cardshot{display:block;width:100%;max-width:360px;margin:0 auto;border-radius:18px;border:1px solid var(--line);box-shadow:0 20px 50px rgba(80,40,10,.15);background:#fff}
.cardshots{display:grid;grid-template-columns:repeat(3,1fr);gap:18px;margin-top:30px;align-items:start}@media (max-width:900px){.cardshots{grid-template-columns:1fr}}
.buysec{background:#fff;border-top:1px solid var(--line)}
.buy5{display:grid;grid-template-columns:repeat(6,1fr);gap:18px;margin-top:36px}
.btile{grid-column:span 2;background:var(--bg);border:1px solid var(--line);border-radius:22px;padding:16px;display:flex;flex-direction:column}
.btile.bt-reviews,.btile.bt-advance{grid-column:span 3}
.btile .bimg{height:230px;overflow:hidden;border-radius:14px;background:#fff;border:1px solid var(--line);margin-bottom:14px;display:flex;align-items:flex-start;justify-content:center}
.btile .bimg img{width:100%;max-width:300px;display:block}.btile h3{font-size:1.08rem;margin:0 0 4px}.btile p{color:var(--muted);font-size:.92rem}
.protect{margin-top:20px;display:flex;gap:14px;align-items:center;background:var(--soft);border-radius:20px;padding:16px 20px}
.protect .ic{width:44px;height:44px;border-radius:12px;background:#fff;color:var(--brand);display:flex;align-items:center;justify-content:center;flex:none}.protect p{flex:1;font-weight:600}
@media (max-width:1000px){.buy5{grid-template-columns:1fr 1fr}.btile,.btile.bt-reviews,.btile.bt-advance{grid-column:span 1}.btile.bt-advance{grid-column:span 2}}
@media (max-width:560px){.buy5{display:flex;overflow-x:auto;scroll-snap-type:x mandatory;margin:30px -20px 0;padding:0 20px 6px;scrollbar-width:none}.buy5::-webkit-scrollbar{display:none}
  .btile,.btile.bt-advance{flex:0 0 80%;scroll-snap-align:center}.protect{flex-wrap:wrap}}
.newpill{display:inline-flex;align-items:center;gap:8px;margin-top:12px;background:#1d1a16;color:#fff;border-radius:99px;padding:8px 14px 8px 8px;font-weight:700;font-size:.88rem;text-decoration:none;min-height:40px}
.newpill span{background:var(--brand);border-radius:99px;padding:3px 9px;font-size:.75rem;font-weight:900;letter-spacing:.06em}
.newsec{background:#16130f;color:#fff}.newsec .lead{color:#c9bfb3}
.new2{display:grid;grid-template-columns:1fr 1fr;gap:22px;margin-top:36px}
.newcard{display:grid;grid-template-columns:200px 1fr;gap:20px;background:#221d18;border:1px solid #3a322a;border-radius:26px;padding:20px;text-decoration:none;color:#fff;transition:border-color .15s}
.newcard:hover{border-color:#ffb07a}
.newcard .nimg{border-radius:22px;overflow:hidden;border:6px solid #000;align-self:start}.newcard .nimg img{width:100%;display:block}
.newcard h3{font-size:1.3rem;margin:12px 0 6px}.newcard p{color:#c9bfb3;font-size:.95rem}
.newcard ul{list-style:none;padding:0;margin:12px 0 14px;display:grid;gap:6px}.newcard li{padding-left:20px;position:relative;font-size:.93rem}
.newcard li:before{content:"";position:absolute;left:2px;top:.55em;width:10px;height:6px;border-left:2.5px solid #69db7c;border-bottom:2.5px solid #69db7c;transform:rotate(-45deg)}
.newcard .go{font-weight:800;color:#ffb07a}
@media (max-width:1000px){.new2{grid-template-columns:1fr}}
@media (max-width:560px){.newcard{grid-template-columns:1fr}.newcard .nimg{max-width:240px;margin:0 auto}}
.pricing{background:#fff;border-top:1px solid var(--line);border-bottom:1px solid var(--line)}
.plans{display:grid;grid-template-columns:repeat(3,1fr);gap:20px;margin-top:36px;align-items:stretch}
.plan{background:var(--bg);border:1px solid var(--line);border-radius:24px;padding:26px 24px;display:flex;flex-direction:column}
.plan.mid{border:2px solid var(--brand);background:#fff;box-shadow:0 18px 40px rgba(226,86,12,.12)}
.plan .tag{align-self:flex-start;margin-bottom:14px}
.plan h3{font-size:1.3rem;margin:0}
.plan .amt{display:flex;align-items:baseline;gap:6px;margin:8px 0 4px}.plan .amt b{font-size:2.6rem;font-weight:900;letter-spacing:-1px}.plan .amt span{color:var(--muted);font-weight:700}
.plan .lim{font-weight:800}.plan .extra{color:var(--muted);font-size:.93rem;margin-top:8px}
.plan .extra{margin-bottom:22px}.plan .btn{margin-top:auto;width:100%}
.incl{margin-top:22px;border:1px solid var(--line);border-radius:22px;padding:18px 22px;display:grid;grid-template-columns:170px 1fr;gap:16px;align-items:start}
.incl ul{list-style:none;padding:0;display:grid;grid-template-columns:repeat(4,1fr);gap:8px 18px;color:var(--muted);font-size:.93rem}
.incl li:before{content:"✓ ";color:var(--green);font-weight:900}
.note.small{font-size:.9rem;font-weight:500;margin-top:24px;padding-left:14px;border-left:3px solid var(--line)}
.dark .lead{margin-top:6px}
.bento{display:grid;grid-template-columns:repeat(4,1fr);gap:18px;margin-top:40px}
.tile{background:#221d18;border:1px solid #3a322a;border-radius:24px;padding:24px 22px 0;display:flex;flex-direction:column;overflow:hidden}
.tile .ic{color:#ffb07a;margin-bottom:12px;display:block}
.tile h3{color:#fff}.tile p{color:#c9bfb3;font-size:.94rem;margin-bottom:20px}
.tile .crop{margin-top:auto;height:290px;border-radius:20px 20px 0 0;overflow:hidden;border:6px solid #000;border-bottom:0;background:#000}
.tile .crop img{width:100%;height:100%;object-fit:cover}
.profit{background:var(--soft);padding:0;overflow:hidden}
.profit .wrap{display:grid;grid-template-columns:1.2fr .8fr;gap:48px;align-items:center}
.profit .wrap>div{padding:64px 0}
.peek{margin:0;align-self:end;height:340px;overflow:hidden;border-radius:30px 30px 0 0;border:9px solid #1d1a16;border-bottom:0;max-width:290px;justify-self:center;margin-top:48px;box-shadow:0 -10px 50px rgba(80,40,10,.18)}
.peek img{width:100%;border-radius:22px 22px 0 0;margin-top:-27%}
@media (max-width:1000px){.fgroups{grid-template-columns:1fr 1fr}.incl ul{grid-template-columns:1fr 1fr}.incl{grid-template-columns:1fr}.bento,.gets{grid-template-columns:1fr 1fr}.nots{grid-template-columns:1fr}.nots ul{grid-template-columns:1fr}}
@media (max-width:900px){
  .split .wrap,.split.rev .wrap,.profit .wrap{grid-template-columns:1fr;gap:36px}
  .split.rev .pair{order:2}
  .pair{max-width:460px;margin:0 auto;width:100%}
  .profit .wrap>div{padding:56px 0 0}.peek{margin-top:0}
  nav.links{display:none}
  .hero .wrap,.pain .wrap,.paise .wrap,.hindi .wrap,.formsec .wrap{grid-template-columns:1fr}
  .phones{height:470px;max-width:440px;margin:0 auto;width:100%}
  .phone{width:205px}
  .steps,.grid{grid-template-columns:1fr 1fr}
  .onb,.pay,.plans,.fgroups{grid-template-columns:1fr}
  .fgroups{gap:12px}details.fgroup{padding:16px 18px}summary.fhead{cursor:pointer;min-height:44px}
  .fcount{display:inline-flex;margin-left:auto;font-weight:800;color:var(--muted);font-size:.85rem}
  summary.fhead:after{content:"+";font-size:1.4rem;color:var(--brand);margin-left:10px}details.fgroup[open] summary.fhead:after{content:"–"}
  section{padding:56px 0}
}
@media (max-width:560px){
  header .wrap{gap:10px}.login .long{display:none}.login .short{display:inline}.links{display:none}header .btn.sm{white-space:nowrap}
  .steps,.grid,.fields{grid-template-columns:1fr}
  .step .shot{aspect-ratio:9/11}
  .phones{height:420px}.phone{width:180px}.phones .p1{left:0}.phones .p2{right:0}
  .duo .phone{width:46%}
  .ctas .btn{width:100%}
  .ticks.two{grid-template-columns:1fr}
  .bento,.gets{grid-template-columns:1fr}.tile .crop{height:250px}.get .crop{height:170px}
  .pair .b{margin-top:36px}
}@media (max-width:430px){
  header .wrap{gap:8px;padding-left:14px;padding-right:14px}.logo{font-size:1.08rem;gap:6px}header .btn.sm{padding:0 12px}header .btn .long{display:none}header .btn .short{display:inline}
}
@media (max-width:380px){
  header .logo>:not(i){display:none}
}

/* ===== Landing v3 ===== */
nav.links a{display:inline-flex;align-items:center;min-height:44px}
.menu{display:none;position:relative;border:0;background:none;border-radius:0}.menu>summary{list-style:none;cursor:pointer;display:inline-flex;align-items:center;gap:6px;min-height:40px;padding:0 12px;border:1px solid var(--line);border-radius:12px;background:#fff;font-weight:800;font-size:.92rem}
.menu>summary::-webkit-details-marker{display:none}.menu>summary:after,.menu[open]>summary:after{content:none}
.menu .panel{position:absolute;right:0;top:48px;width:260px;background:#fff;border:1px solid var(--line);border-radius:18px;box-shadow:0 20px 50px rgba(60,30,10,.18);padding:8px;display:grid;z-index:30}
.menu .panel a{display:flex;align-items:center;gap:10px;min-height:44px;padding:0 12px;border-radius:10px;text-decoration:none;font-weight:700}.menu .panel a:hover{background:var(--soft)}
.menu .panel small{padding:10px 12px 2px;color:var(--muted);font-weight:800;font-size:.75rem;letter-spacing:.06em;text-transform:uppercase}
.stickycta{position:fixed;left:12px;right:12px;bottom:12px;z-index:25;display:none;align-items:center;justify-content:space-between;gap:10px;background:#1d1a16;color:#fff;border-radius:18px;padding:10px 10px 10px 16px;box-shadow:0 14px 40px rgba(0,0,0,.35);transform:translateY(140%);transition:transform .25s}
.stickycta.on{transform:none}.stickycta span{font-weight:700;font-size:.92rem;line-height:1.25}.stickycta .btn{min-height:44px;padding:0 16px;flex:none}
.social{display:flex;gap:10px;margin-top:12px}.social a{width:44px;height:44px;border-radius:12px;border:1px solid var(--line);background:#fff;display:inline-flex;align-items:center;justify-content:center;color:var(--ink);padding:0}
.social a:hover{border-color:var(--brand);color:var(--brand)}
.swipehint{display:none;text-align:center;color:var(--muted);font-weight:700;font-size:.85rem;margin-top:10px}
.badge2{display:inline-flex;align-items:center;gap:8px;background:#fff;border:1px solid var(--line);border-radius:99px;padding:7px 14px;font-weight:800;font-size:.85rem;color:var(--deep)}
.hero2{padding:40px 0 30px;background:radial-gradient(circle at 85% 10%,#ffe3cf,transparent 45%),radial-gradient(circle at 5% 90%,#fff0e2,transparent 40%)}
.hero2 .wrap{display:grid;grid-template-columns:1.15fr .85fr;gap:40px;align-items:center}
.hero2 h1{font-size:clamp(2.2rem,5.2vw,3.5rem);margin-top:14px}.hero2 h1 span{color:var(--brand)}
.hero2 .lead{margin:14px 0 18px;color:#4a423a}
.jobchips{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin:0 0 22px;max-width:560px}
.jobchip{display:flex;gap:10px;align-items:center;background:#fff;border:1px solid var(--line);border-radius:16px;padding:10px 12px;text-decoration:none}
.jobchip .ic{width:38px;height:38px;border-radius:11px;background:var(--soft);color:var(--brand);display:flex;align-items:center;justify-content:center;flex:none}
.jobchip b{display:block;font-size:1rem}.jobchip small{color:var(--muted);font-size:.85rem}
.notshop{margin-top:14px;font-size:.9rem;color:var(--muted);font-weight:600;display:flex;gap:8px;align-items:center}
.notshop:before{content:"";width:8px;height:8px;border-radius:50%;background:var(--brand);flex:none}
.vphone{position:relative;width:280px;margin:0 auto;border-radius:40px;background:#1d1a16;padding:9px;box-shadow:0 30px 70px rgba(80,40,10,.28)}
.vphone video,.vphone img{display:block;width:100%;aspect-ratio:432/936;border-radius:32px;background:#fff;object-fit:cover}
.vcap{text-align:center;font-size:.85rem;color:var(--muted);font-weight:600;margin-top:12px}
.flow4{display:grid;grid-template-columns:repeat(4,1fr);gap:18px;margin-top:36px;counter-reset:st}
.fstep{background:#fff;border:1px solid var(--line);border-radius:22px;padding:16px;display:flex;flex-direction:column}
.fstep .n{width:32px;height:32px;border-radius:50%;background:var(--brand);color:#fff;font-weight:900;display:flex;align-items:center;justify-content:center;margin-bottom:10px}
.fstep p{color:var(--muted);font-size:.93rem;margin-bottom:14px}
.fstep .clip{margin-top:auto;border-radius:18px;overflow:hidden;border:5px solid #1d1a16;background:#fff}
.fstep .clip video,.fstep .clip img{display:block;width:100%;aspect-ratio:432/600;object-fit:cover;object-position:top}
.jobs4{display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-top:36px}
.job{background:#fff;border:1px solid var(--line);border-radius:24px;padding:24px;display:flex;flex-direction:column;text-decoration:none;color:inherit;transition:border-color .15s,box-shadow .15s}
.job:hover{border-color:var(--brand);box-shadow:0 14px 34px rgba(226,86,12,.12)}
.job .top{display:flex;gap:12px;align-items:center;margin-bottom:6px}.job .top h3{margin:0;font-size:1.3rem}
.job .ic{width:46px;height:46px;border-radius:13px;background:var(--soft);color:var(--brand);display:flex;align-items:center;justify-content:center;flex:none}
.job .inst{color:var(--muted);font-size:.9rem;margin:2px 0 12px}
.job ul{list-style:none;padding:0;display:grid;gap:8px;margin-bottom:16px}.job li{padding-left:22px;position:relative}
.job li:before{content:"";position:absolute;left:2px;top:.55em;width:10px;height:6px;border-left:2.5px solid var(--green);border-bottom:2.5px solid var(--green);transform:rotate(-45deg)}
.job .go{margin-top:auto;font-weight:800;color:var(--brand)}
.growrow{margin-top:18px;display:flex;gap:16px;align-items:center;background:var(--soft);border-radius:22px;padding:18px 22px;text-decoration:none;color:inherit}
.growrow .ic{width:46px;height:46px;border-radius:13px;background:#fff;color:var(--brand);display:flex;align-items:center;justify-content:center;flex:none}
.growrow p{color:var(--muted);font-size:.93rem}.growrow .go{margin-left:auto;font-weight:800;color:var(--brand);white-space:nowrap}
.daytbl{width:100%;border-collapse:separate;border-spacing:0;margin-top:30px;background:#fff;border:1px solid var(--line);border-radius:22px;overflow:hidden}
.daytbl th,.daytbl td{padding:14px 18px;text-align:left;border-bottom:1px solid var(--line);vertical-align:top}
.daytbl tr:last-child td{border-bottom:0}.daytbl th{background:var(--soft);font-size:.85rem;text-transform:uppercase;letter-spacing:.05em;color:var(--deep)}
.daytbl td:first-child{font-weight:800}.daytbl td:nth-child(2){color:#a51d1d}.daytbl td:nth-child(3){color:var(--green);font-weight:700}
.who4{display:grid;grid-template-columns:repeat(4,1fr);gap:16px;margin-top:30px}
.whot{background:#fff;border:1px solid var(--line);border-radius:20px;padding:20px}
.whot .ic{width:44px;height:44px;border-radius:12px;background:var(--soft);color:var(--brand);display:flex;align-items:center;justify-content:center;margin-bottom:10px}
.whot small{color:var(--muted)}
.feathero{padding:40px 0 20px}.feathero .wrap{display:grid;grid-template-columns:1.1fr .9fr;gap:40px;align-items:center}
.feathero h1{font-size:clamp(2rem,4.6vw,3rem);margin:10px 0 14px}
.fitems{display:grid;grid-template-columns:repeat(2,1fr);gap:14px;margin-top:26px}
.fitem{background:#fff;border:1px solid var(--line);border-radius:18px;padding:16px 18px}.fitem b{display:block;margin-bottom:3px}.fitem span{color:var(--muted);font-size:.93rem}
.fsteps{list-style:none;padding:0;display:grid;gap:12px;margin-top:20px;counter-reset:fs}
.fsteps li{display:flex;gap:12px;align-items:flex-start;font-weight:600}.fsteps li:before{counter-increment:fs;content:counter(fs);flex:none;width:30px;height:30px;border-radius:50%;background:var(--brand);color:#fff;font-weight:900;display:flex;align-items:center;justify-content:center}
.othjobs{display:flex;flex-wrap:wrap;gap:10px;margin-top:16px}
.othjobs a{display:inline-flex;gap:8px;align-items:center;background:#fff;border:1px solid var(--line);border-radius:99px;padding:10px 16px;font-weight:700;text-decoration:none;min-height:44px}
.ctabox{background:linear-gradient(160deg,var(--brand2),var(--brand) 60%,var(--deep));color:#fff;border-radius:26px;padding:30px;display:flex;gap:20px;align-items:center;justify-content:space-between;flex-wrap:wrap}
.ctabox p{color:#ffe8d9}.ctabox .btn{background:#fff;color:var(--deep)}
@media (max-width:1000px){.flow4,.who4{grid-template-columns:repeat(2,minmax(0,1fr))}.whot h3{overflow-wrap:anywhere}}
@media (max-width:430px){.menu .mt{display:none}.menu>summary{padding:0 10px;min-width:44px;justify-content:center}}
@media (max-width:980px){.menu{display:block}header .login{display:none}.stickycta{display:flex}}
@media (max-width:900px){.hero2 .wrap{display:flex;flex-direction:column;gap:0}.hero2 .htext{display:contents}
  .hero2 .badge2{order:1;align-self:flex-start}.hero2 h1{order:2}.hero2 .lead{order:3}.hero2 .hvid{order:4;margin:0 0 20px}.hero2 .jobchips{order:5}.hero2 .ctas{order:6}.hero2 .heronote{order:7}.hero2 .notshop{order:8}.hero2 .newpill{order:9;align-self:flex-start}
  .hero2 .hvid .vphone{width:210px;border-radius:32px;padding:7px}.hero2 .hvid .vphone video{border-radius:26px}
  .feathero .wrap{grid-template-columns:1fr;gap:28px}.jobs4,.fitems{grid-template-columns:1fr}.vphone{width:240px}}
@media (max-width:700px){
  .flow4{display:flex;overflow-x:auto;scroll-snap-type:x mandatory;gap:14px;margin:30px -20px 0;padding:0 20px 6px;scrollbar-width:none}.flow4::-webkit-scrollbar{display:none}
  .fstep{flex:0 0 78%;scroll-snap-align:center}.swipehint{display:block}
  .daytbl thead{display:none}.daytbl,.daytbl tbody,.daytbl tr,.daytbl td{display:block;width:100%}.daytbl{background:none;border:0}
  .daytbl tr{background:#fff;border:1px solid var(--line);border-radius:18px;margin-bottom:10px;padding:12px 16px}
  .daytbl td{border:0;padding:3px 0}.daytbl td:first-child{font-size:1.05rem;margin-bottom:4px}
  .daytbl td:nth-child(2):before{content:attr(data-l) ": ";font-weight:800}.daytbl td:nth-child(3):before{content:attr(data-l) ": ";font-weight:800}}
@media (max-width:560px){.jobchips{grid-template-columns:1fr 1fr}.jobchip{padding:9px 10px}.jobchip .ic{width:32px;height:32px}.jobchip small{display:none}
  .growrow{flex-wrap:wrap}.growrow .go{margin-left:0}footer{padding-bottom:90px}}
`

const Logo = () => <a class="logo" href="/"><i><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5.2 3h13.6L21 9a3 3 0 0 1-6 0 3 3 0 0 1-6 0 3 3 0 0 1-6 0z" fill="#fff" stroke-width="1.4" /><path d="M5 12.6V21h14v-8.4M10 21v-5h4v5" /></svg></i><span>NukkadSale</span></a>
const Phone = (p: { img: string; cls?: string; alt: string; eager?: boolean }) => <div class={`phone ${p.cls ?? ''}`}><img src={`/site/${p.img}.webp`} alt={p.alt} loading={p.eager ? 'eager' : 'lazy'} fetchpriority={p.eager ? 'high' : undefined} width="540" height="1169" /></div>
/** A looping, silent clip of real app screens (public/site/clips, made by tests/e2e/social/render-clips.mjs). */
const Clip = (p: { name: string; lang: 'en' | 'hi'; alt: string; eager?: boolean }) => (
  p.eager
    ? <video autoplay muted loop playsinline preload="auto" poster={`/site/clips/${p.name}-${p.lang}.webp`} aria-label={p.alt} title={p.alt}><source src={`/site/clips/${p.name}-${p.lang}.mp4`} type="video/mp4" /></video>
    : <video muted loop playsinline preload="none" poster={`/site/clips/${p.name}-${p.lang}.webp`} aria-label={p.alt} title={p.alt} data-src={`/site/clips/${p.name}-${p.lang}.mp4`} />
)
// Clips below the fold start loading when they come near the screen; reduced-motion users get the still image.
const CLIP_JS = `(function(){var v=[].slice.call(document.querySelectorAll('video'));if(matchMedia('(prefers-reduced-motion: reduce)').matches){v.forEach(function(x){x.removeAttribute('autoplay');x.pause()});return}
function go(x){if(x.dataset.src){x.src=x.dataset.src;delete x.dataset.src}x.play().catch(function(){})}
if(!('IntersectionObserver' in window)){v.forEach(go);return}var io=new IntersectionObserver(function(es){es.forEach(function(e){if(e.isIntersecting)go(e.target);else e.target.pause()})},{rootMargin:'150px'});v.forEach(function(x){io.observe(x)})})();
// Phones: a "Get your shop" bar once the first screen is scrolled past (hidden again at the form).
(function(){var bar=document.getElementById('stickycta'),hero=document.querySelector('[data-sec=hero]'),form=document.getElementById('get-started');if(!bar||!hero||!('IntersectionObserver' in window))return;var h=true,f=false;function u(){bar.classList.toggle('on',!h&&!f)}
new IntersectionObserver(function(e){h=e[0].isIntersecting;u()}).observe(hero);if(form)new IntersectionObserver(function(e){f=e[0].isIntersecting;u()}).observe(form)})();`

// Outline marks for the footer (same stroke style as the line icons).
const SOCIAL_SVG = {
  ig: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.3" cy="6.7" r="1" fill="currentColor" stroke="none"/></svg>',
  fb: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M14.5 21v-7.5h2.6l.4-3h-3V8.6c0-.9.3-1.6 1.6-1.6h1.6V4.3c-.3 0-1.2-.1-2.3-.1-2.3 0-3.9 1.4-3.9 4v2.3H9v3h2.5V21"/></svg>',
  yt: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" aria-hidden="true"><rect x="2.5" y="5.5" width="19" height="13" rx="4"/><path d="M10 9.2v5.6l4.8-2.8z" fill="currentColor"/></svg>',
}

function Page(p: { c: Context<AppEnv>; k: Copy; lang: 'en' | 'hi'; back: string; title?: string; desc?: string; children: Child }) {
  const origin = new URL(p.c.req.url).origin
  const title = p.title ?? p.k.title
  return (
    <html lang={p.lang}>
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover" />
        <title>{title}</title>
        <meta name="description" content={p.desc ?? p.k.desc} />
        <meta name="theme-color" content="#e2560c" />
        <link rel="icon" href="/icon-192.png" />
        <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
        <link rel="canonical" href={`${origin}${p.back === '/' ? '/' : p.back}`} />
        <meta property="og:type" content="website" />
        <meta property="og:title" content={title} />
        <meta property="og:description" content={p.desc ?? p.k.desc} />
        <meta property="og:image" content={`${origin}/site/og.jpg`} />
        <meta property="og:url" content={`${origin}${p.back}`} />
        <meta name="twitter:card" content="summary_large_image" />
        <style>{raw(CSS)}</style>
      </head>
      <body>
        <header>
          <div class="wrap">
            <Logo />
            <nav class="links">{['how', 'jobs', 'buyers', 'pricing', 'faq'].map((id, i) => <a href={`/#${id}`}>{p.k.nav[i]}</a>)}</nav>
            <span class="hgap" />
            <a class="lang" href={`/lang?to=${p.k.otherLang}&back=${encodeURIComponent(p.back)}`} lang={p.k.otherLang}>{p.k.other}</a>
            <a class="login" href="/seller"><span class="long">{p.k.login}</span><span class="short">{p.k.loginShort}</span></a>
            <details class="menu">
              <summary aria-label={p.k.menu}>{raw('<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16"/></svg>')}<span class="mt">{p.k.menu}</span></summary>
              <div class="panel">
                {['how', 'jobs', 'buyers', 'pricing', 'faq'].map((id, i) => <a href={`/#${id}`}>{p.k.nav[i]}</a>)}
                <small>{p.k.featNav}</small>
                {SLUGS.map((s) => <a href={`/features/${s}`}>{svgIcon(FEATURES[s].icon, 18)}{FEATURES[s][p.lang].name}</a>)}
                <small>NukkadSale</small>
                <a href="/seller">{svgIcon('key', 18)}{p.k.login}</a>
              </div>
            </details>
            <a class="btn primary sm" href="/#get-started"><span class="long">{p.k.cta}</span><span class="short">{p.k.ctaShort}</span></a>
          </div>
        </header>
        <main>{p.children}</main>
        <div class="stickycta" id="stickycta"><span>{p.k.stickyCta}</span><a class="btn primary" href="/#get-started" data-track="Sticky · Get your shop">{p.k.cta}</a></div>
        <footer>
          <div class="wrap">
            <div><Logo /><p style="margin-top:6px">{p.k.footer}</p>
              <div class="social">
                <a href="https://www.instagram.com/nukkadsale_official/" target="_blank" rel="noopener" aria-label="Instagram">{raw(SOCIAL_SVG.ig)}</a>
                <a href="https://www.facebook.com/1416035184930328" target="_blank" rel="noopener" aria-label="Facebook">{raw(SOCIAL_SVG.fb)}</a>
                <a href="https://www.youtube.com/@nukkadsale" target="_blank" rel="noopener" aria-label="YouTube">{raw(SOCIAL_SVG.yt)}</a>
              </div>
            </div>
            <nav>{SLUGS.map((s) => <a href={`/features/${s}`}>{FEATURES[s][p.lang].name}</a>)}</nav>
            <nav>{p.k.policies.map(([href, l]) => <a href={href}>{l}</a>)}<a href="/login">{p.k.login}</a></nav>
          </div>
        </footer>
        <script>{raw(TRACK_JS)}</script>
        <script>{raw(CLIP_JS)}</script>
      </body>
    </html>
  )
}

const Options = ({ map, lang, value, placeholder }: { map: Record<string, { en: string; hi: string }>; lang: 'en' | 'hi'; value?: string; placeholder: string }) => (
  <>
    <option value="">{placeholder}</option>
    {Object.entries(map).map(([k, v]) => <option value={k} selected={value === k}>{v[lang]}</option>)}
  </>
)

const GetStarted = ({ k, lang, err }: { k: Copy; lang: 'en' | 'hi'; err?: string }) => (
<section class="formsec" id="get-started" data-sec="form">
    <div class="wrap">
      <div>
        <span class="eyebrow" style="color:#ffe8d9">{k.formEyebrow}</span>
        <h2>{k.formH}</h2>
        <p class="lead">{k.formP}</p>
      </div>
      <form class="card" id="getstarted" method="post" action="/get-started">
        {err && <div class="err">{err}</div>}
        <div class="fields">
          <div><label for="name">{k.f.name}</label><input id="name" name="name" autocomplete="name" required maxlength={60} /></div>
          <div><label for="phone">{k.f.phone}</label><div class="tel"><span>+91</span><input id="phone" name="phone" type="tel" inputmode="numeric" autocomplete="tel-national" maxlength={14} placeholder="98XXXXXXXX" required /></div></div>
          <div><label for="business">{k.f.business}</label><input id="business" name="business" required maxlength={80} /></div>
          <div><label for="sells">{k.f.sells}</label><input id="sells" name="sells" placeholder={k.f.sellsPh} maxlength={120} /></div>
        </div>
        <details class="more">
          <summary>{k.f.more}</summary>
          <div class="fields" style="margin-top:14px">
            <div><label for="city">{k.f.city}</label><input id="city" name="city" autocomplete="address-level2" maxlength={60} /></div>
            <div><label for="channel">{k.f.channel}</label><select id="channel" name="channel"><Options map={CHANNELS} lang={lang} placeholder={k.f.choose} /></select></div>
            <div><label for="volume">{k.f.volume}</label><select id="volume" name="volume"><Options map={VOLUMES} lang={lang} placeholder={k.f.choose} /></select></div>
            <div><label for="payments">{k.f.payments}</label><select id="payments" name="payments"><Options map={PAYMENTS} lang={lang} placeholder={k.f.choose} /></select></div>
          </div>
          <div style="margin-top:14px"><label for="message">{k.f.message}</label><textarea id="message" name="message" maxlength={1000} /></div>
        </details>
        <div class="hp" aria-hidden="true"><label for="website">Website</label><input id="website" name="website" tabindex={-1} autocomplete="off" /></div>
        <button class="btn primary" type="submit" style="width:100%;min-height:54px;font-size:1.05rem">{k.f.submit}</button>
        <p class="consent">{k.f.consent} <a href="/privacy">{k.f.privacy}</a>.</p>
      </form>
    </div>
  </section>
)

// The section under the hero, the pricing cards, the FAQ and the form are shared by home and feature pages.
const Pricing = ({ k }: { k: Copy }) => (
  <section id="pricing" class="pricing" data-sec="pricing">
    <div class="wrap">
      <div class="center"><span class="eyebrow">{k.priceEyebrow}</span><h2>{k.priceH}</h2><p class="lead">{k.priceP}</p></div>
      <div class="plans">
        {k.plans.map((pl, i) => (
          <div class={`plan${i === 1 ? ' mid' : ''}`}>
            <span class="tag">{pl.tag}</span>
            <h3>{pl.name}</h3>
            <div class="amt"><b>{pl.price}</b><span>{pl.per}</span></div>
            <p class="lim">{pl.limit}</p>
            {pl.extra && <p class="extra">{pl.extra}</p>}
            <a class={`btn ${i === 1 ? 'primary' : 'ghost'}`} href="/#get-started" data-track={`Pricing · ${pl.cta}`}>{pl.cta}</a>
          </div>
        ))}
      </div>
      <div class="incl"><b>{k.planIncl}</b><ul>{k.incl.map((x) => <li>{x}</li>)}</ul></div>
      <p class="note center">{k.priceNote}</p>
    </div>
  </section>
)

site.get('/', async (c) => {
  if (await currentSeller(c)) return c.redirect('/app')
  const lang = getLang(c), k = C[lang], bot = waBotEnabled(c.env)
  const err = c.req.query('err')
  return c.html('<!doctype html>' + (
    <Page c={c} k={k} lang={lang} back="/">
      <section class="hero2" data-sec="hero">
        <div class="wrap">
          <div class="htext">
            <span class="badge2">{svgIcon('chat', 16)}{k.badge}</span>
            <h1>{k.h1a}<br /><span>{k.h1b}</span></h1>
            <p class="lead">{k.sub}</p>
            <div class="jobchips">
              {k.heroJobs.map(([ic, h, s], i) => <a class="jobchip" href={`/features/${SLUGS[i]}`}><span class="ic">{svgIcon(ic, 20)}</span><span><b>{h}</b><small>{s}</small></span></a>)}
            </div>
            <div class="ctas"><a class="btn primary" href="#get-started">{k.heroCta}</a><a class="btn ghost" href="#how">{k.heroCta2}</a></div>
            <p class="heronote">{k.heroNote}</p>
            <p class="notshop">{k.notShop}</p>
            <a class="newpill" href="#new" data-track="Hero · new features"><span>NEW</span>{k.newPill} →</a>
          </div>
          <div class="hvid">
            <div class="vphone"><Clip name="flow" lang={lang} alt={k.videoAlt} eager /></div>
            <p class="vcap">{k.videoCap}</p>
          </div>
        </div>
      </section>

      <section id="how" data-sec="how" style="background:#fff;border-top:1px solid var(--line);border-bottom:1px solid var(--line)">
        <div class="wrap">
          <div class="center"><span class="eyebrow">{k.howEyebrow}</span><h2>{k.howH}</h2><p class="lead">{k.howP}</p></div>
          <div class="flow4">
            {k.steps.map(([clip, h, p], i) => (
              <div class="fstep"><span class="n">{i + 1}</span><h3>{h}</h3><p>{p}</p><div class="clip"><Clip name={clip} lang={lang} alt={h} /></div></div>
            ))}
          </div>
          <p class="swipehint">{k.swipe}</p>
        </div>
      </section>

      <section id="jobs" data-sec="jobs">
        <div class="wrap">
          <div class="center"><span class="eyebrow">{k.jobsEyebrow}</span><h2>{k.jobsH}</h2><p class="lead">{k.jobsP}</p></div>
          <div class="jobs4">
            {k.jobs.map(([slug, ic, h, inst, pts, go]) => (
              <a class="job" href={`/features/${slug}`} data-track={`Job · ${slug}`}>
                <div class="top"><span class="ic">{svgIcon(ic as string, 24)}</span><h3>{h}</h3></div>
                <p class="inst">{inst}</p>
                <ul>{(pts as string[]).map((x) => <li>{x}</li>)}</ul>
                <span class="go">{go} →</span>
              </a>
            ))}
          </div>
          <a class="growrow" href="/features/grow" data-track="Job · grow"><span class="ic">{svgIcon(k.grow[0], 24)}</span><div><b>{k.grow[1]}</b><p>{k.grow[2]}</p></div><span class="go">{k.grow[3]} →</span></a>
        </div>
      </section>

      <section id="buyers" class="buysec" data-sec="buyers">
        <div class="wrap">
          <div class="center"><span class="eyebrow">{k.buyEyebrow}</span><h2>{k.buyH}</h2><p class="lead">{k.buyP}</p></div>
          <div class="buy5">
            {k.buyTiles.map(([img, h, p]) => (
              <div class={`btile bt-${img}`}><div class="bimg"><img src={`/site/t-${img}-${lang}.webp`} alt={h} loading="lazy" /></div><h3>{h}</h3><p>{p}</p></div>
            ))}
          </div>
          <div class="protect"><span class="ic">{svgIcon('lock', 22)}</span><p>{k.buyProtect}</p><a class="btn sm" href="/features/buyers" data-track="Buyers · see all">{k.buyMore} →</a></div>
        </div>
      </section>

      <section id="new" class="newsec" data-sec="new">
        <div class="wrap">
          <div class="center"><span class="eyebrow" style="color:#ffb07a">{k.newEyebrow}</span><h2>{k.newH}</h2><p class="lead">{k.newP}</p></div>
          <div class="new2">
            {k.newCards.map(([slug, name, h, p, pts, go]) => (
              <a class="newcard" href={`/features/${slug}`} data-track={`New · ${slug}`}>
                <div class="nimg"><img src={`/site/${slug}-${lang}.webp`} alt={name as string} loading="lazy" width="540" height="1169" /></div>
                <div class="ntext">
                  <span class="badge2" style="background:#2a241e;border-color:#3a322a;color:#ffb07a">{svgIcon(slug === 'live' ? 'bell' : 'users', 16)}{name}</span>
                  <h3>{h}</h3><p>{p}</p>
                  <ul>{(pts as string[]).map((x) => <li>{x}</li>)}</ul>
                  <span class="go">{go} →</span>
                </div>
              </a>
            ))}
          </div>
        </div>
      </section>

      <section data-sec="day" style="background:var(--soft)">
        <div class="wrap">
          <div class="center"><span class="eyebrow">{k.dayEyebrow}</span><h2>{k.dayH}</h2></div>
          <table class="daytbl">
            <thead><tr>{k.dayCols.map((x) => <th>{x}</th>)}</tr></thead>
            <tbody>{k.day.map(([a, b, cc]) => <tr><td>{a}</td><td data-l={k.dayCols[1]}>{b}</td><td data-l={k.dayCols[2]}>{cc}</td></tr>)}</tbody>
          </table>
        </div>
      </section>

      <section data-sec="who">
        <div class="wrap">
          <div class="center"><span class="eyebrow">{k.whoEyebrow}</span><h2>{k.whoH}</h2><p class="lead">{k.whoP}</p></div>
          <div class="who4">{k.who.map(([ic, h, s]) => <div class="whot"><span class="ic">{svgIcon(ic, 22)}</span><h3>{h}</h3><small>{s}</small></div>)}</div>
        </div>
      </section>

      <Pricing k={k} />

      <section id="faq" style="padding-top:20px" data-sec="faq">
        <div class="wrap">
          <div class="center"><span class="eyebrow">{k.faqEyebrow}</span><h2>{k.faqH}</h2></div>
          <div class="faq">{k.faq(bot).map(([q, a]) => <details><summary>{q}</summary><p>{a}</p></details>)}</div>
        </div>
      </section>

      <GetStarted k={k} lang={lang} err={err} />
    </Page>
  ))
})

// ---------- "What it does" pages: one per job ----------
site.get('/features', (c) => c.redirect('/#jobs', 301))
site.get('/features/', (c) => c.redirect('/#jobs', 301))
site.get('/features/:slug', (c) => {
  const slug = c.req.param('slug') as Slug
  const f = FEATURES[slug]
  if (!f) return c.notFound()
  const lang = getLang(c), k = C[lang], bot = waBotEnabled(c.env), x = f[lang]
  const items: [string, string][] = 'items' in x ? (x.items as unknown as [string, string][]) : k.all(bot)[f.group][2]
  return c.html('<!doctype html>' + (
    <Page c={c} k={k} lang={lang} back={`/features/${slug}`} title={`${x.name} – NukkadSale`} desc={x.sub}>
      <section class="feathero hero2" data-sec={`f-${slug}-hero`}>
        <div class="wrap">
          <div>
            <a class="back" href="/#jobs">{k.backHome}</a>
            <div><span class="badge2">{svgIcon(f.icon, 16)}{x.name}</span></div>
            <h1>{x.h1}</h1>
            <p class="lead">{x.sub}</p>
            <h3 style="margin-top:22px">{k.featSteps}</h3>
            <ol class="fsteps">{x.steps.map((s) => <li>{s}</li>)}</ol>
            <div class="ctas" style="margin-top:24px"><a class="btn primary" href="/#get-started">{k.cta}</a></div>
          </div>
          <div>
            {f.imgs[0].startsWith('t-') ? <img class="cardshot" src={`/site/${f.imgs[0]}-${lang}.webp`} alt={x.name} /> : <div class="vphone">{f.clip ? <Clip name={f.clip} lang={lang} alt={x.name} eager /> : <img src={`/site/${f.imgs[0]}${LANG_IMGS.has(f.imgs[0]) ? `-${lang}` : ''}.webp`} alt={x.name} width="540" height="1169" />}</div>}
          </div>
        </div>
      </section>
      <section data-sec={`f-${slug}-items`} style="padding-top:30px">
        <div class="wrap">
          <h2>{k.featGet}</h2>
          <div class="fitems">{items.map(([t, d]) => <div class="fitem"><b>{t}</b><span>{d}</span></div>)}</div>
          {f.imgs[0].startsWith('t-') ? <div class="cardshots">{['t-size', 't-reviews', 't-advance'].map((img) => <img class="cardshot" src={`/site/${img}-${lang}.webp`} alt="" loading="lazy" />)}</div> : <div class="pair" style="margin-top:36px">{f.imgs.map((img, i) => <Phone img={LANG_IMGS.has(img) ? `${img}-${lang}` : img} cls={i ? 'b' : 'a'} alt={x.name} />)}</div>}
        </div>
      </section>
      <section data-sec={`f-${slug}-more`} style="padding-top:10px">
        <div class="wrap">
          <div class="ctabox"><div><h2 style="margin:0 0 6px">{k.featCtaH}</h2><p>{k.featCtaP}</p></div><a class="btn" href="/#get-started">{k.cta}</a></div>
          <h3 style="margin-top:34px">{k.featMore}</h3>
          <div class="othjobs">{SLUGS.filter((s) => s !== slug).map((s) => <a href={`/features/${s}`}>{svgIcon(FEATURES[s].icon, 18)}{FEATURES[s][lang].name}</a>)}</div>
        </div>
      </section>
    </Page>
  ))
})

site.post('/get-started', async (c) => {
  const lang = getLang(c), k = C[lang]
  const f = await c.req.parseBody()
  const fail = (m: string) => c.redirect('/?err=' + encodeURIComponent(m) + '#get-started', 303)
  const str = (key: string, n: number) => String(f[key] ?? '').trim().slice(0, n)
  // Bots fill the hidden field; pretend it worked.
  if (str('website', 200)) return c.redirect('/thanks', 303)
  const name = str('name', 60), business = str('business', 80)
  const phone = normalizePhone(str('phone', 20))
  if (!name || !business || !str('phone', 20)) return fail(k.errs.fill)
  if (!phone) return fail(k.errs.phone)
  const pick = (key: string, map: object) => (str(key, 40) in map ? str(key, 40) : '')
  const now = Date.now()
  const ipHash = (await sha256((c.req.header('cf-connecting-ip') ?? '') + c.env.SECRET_KEY)).slice(0, 16)
  const recent = await c.env.DB.prepare(`SELECT COUNT(*) AS n FROM leads WHERE ip_hash = ? AND created_at > ?`).bind(ipHash, now - 86_400_000).first<{ n: number }>()
  if ((recent?.n ?? 0) >= 5) return fail(k.errs.many)
  // The same number again within a day updates nothing new – they're already in the inbox.
  const dup = await c.env.DB.prepare(`SELECT id FROM leads WHERE phone = ? AND created_at > ? AND status IN ('new', 'contacted')`).bind(phone, now - 86_400_000).first<{ id: number }>()
  const lead = { name, business, phone, city: str('city', 60), sells: str('sells', 120), channel: pick('channel', CHANNELS), volume: pick('volume', VOLUMES), payments: pick('payments', PAYMENTS), message: str('message', 1000) }
  let id = dup?.id
  if (!id) {
    const r = await c.env.DB.prepare(
      `INSERT INTO leads (name, business, phone, city, sells, channel, volume, payments, message, lang, ip_hash, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(lead.name, lead.business, lead.phone, lead.city, lead.sells, lead.channel, lead.volume, lead.payments, lead.message, lang, ipHash, now, now).run()
    id = Number(r.meta.last_row_id)
    const origin = new URL(c.req.url).origin
    const en = (map: Record<string, { en: string }>, v: string) => map[v]?.en ?? '–'
    const text = [
      `New request to get started on NukkadSale`,
      ``,
      `Name:      ${lead.name}`,
      `Business:  ${lead.business}`,
      `WhatsApp:  ${displayPhone(lead.phone)}  (wa.me/${lead.phone})`,
      `City:      ${lead.city || '–'}`,
      `Sells:     ${lead.sells || '–'}`,
      `Sells on:  ${en(CHANNELS, lead.channel)}`,
      `Orders:    ${en(VOLUMES, lead.volume)}`,
      `Payments:  ${en(PAYMENTS, lead.payments)}`,
      `Language:  ${lang === 'hi' ? 'Hindi' : 'English'}`,
      lead.message ? `\nMessage:\n${lead.message}` : '',
      ``,
      `Open in Admin: ${origin}/admin/leads/${id}`,
    ].join('\n')
    c.executionCtx.waitUntil(notifyOwner(c.env, `New NukkadSale request: ${lead.business} (${lead.name})`, text))
  }
  return c.redirect(`/thanks?p=${phone.slice(2)}`, 303)
})

site.get('/thanks', (c) => {
  const lang = getLang(c), k = C[lang]
  const p = /^\d{10}$/.test(c.req.query('p') ?? '') ? displayPhone('91' + c.req.query('p')) : ''
  return c.html('<!doctype html>' + (
    <Page c={c} k={k} lang={lang} back="/thanks">
      <section class="thanks">
        <div class="wrap">
          <div class="box">
            <h1 style="font-size:1.6rem">{k.thanksH}</h1>
            <p>{p ? k.thanksP(p) : k.formP}</p>
            {c.env.SUPPORT_PHONE && <a class="btn primary" href={waLink(c.env.SUPPORT_PHONE, lang === 'hi' ? 'नमस्ते, मैंने NukkadSale के लिए फ़ॉर्म भरा है।' : 'Hi, I just filled the NukkadSale form.')}>💬 {k.thanksWa}</a>}
            <p style="margin:18px 0 0"><a href="/">{k.back}</a></p>
          </div>
        </div>
      </section>
    </Page>
  ))
})
