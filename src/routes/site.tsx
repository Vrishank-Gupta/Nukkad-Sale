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
    title: 'NukkadSale – Sell on WhatsApp, without the DM chaos',
    desc: 'Take orders from your WhatsApp groups, get paid on UPI and know exactly who paid. Stock held while buyers pay, khata that writes itself. हिंदी + English.',
    nav: ['How it works', 'Features', 'FAQ'], login: 'Seller login', cta: 'Get started', other: 'हिंदी', otherLang: 'hi',
    eyebrow: 'For sellers on WhatsApp',
    h1a: 'Sell on WhatsApp.', h1b: 'Without the DM chaos.',
    sub: (bot: boolean): string => bot
      ? 'Post your products in your groups. Buyers order right in WhatsApp, pay you on UPI – and you know exactly who paid. Stock, orders and khata in one app.'
      : 'Post your products in your groups. Buyers order from your link in seconds, pay you on UPI – and you know exactly who paid. Stock, orders and khata in one app.',
    heroCta: 'Get started – we set it up for you', heroCta2: 'See how it works',
    trust: ['Works on any Android or iPhone', 'हिंदी + English', 'Money goes straight to you'],
    painEyebrow: 'Sound familiar?', painH: 'You post one deal… and your phone explodes.',
    dms: ['Price?', 'M size hai??', 'Mera hold karo pls', 'Payment kaise karu?', 'Still available??', 'COD hai?', 'Photo bhejo', 'Hello??'],
    pains: ['Typing the same price and sizes 50 times', 'Who asked first?', 'The last piece promised to 3 people', 'Scrolling through payment screenshots'],
    howEyebrow: 'How it works', howH: 'From post to paid in 4 steps',
    steps: (bot: boolean) => [
      ['Post your sale', 'Add photos, price and sizes. NukkadSale writes the WhatsApp message – share it in your groups.', 'sale-live'],
      bot ? ['Buyers order in the chat', 'They tap your post. The ordering bot asks size, quantity and address – not you.', 'chat-product']
          : ['Buyers order from your link', 'They tap your link, pick a size and add their address. No app, no sign-up.', 'buyer-sale'],
      bot ? ['They pay the exact amount', 'Every order gets its own paise – a few paise off the price, never more – so the amount tells you who paid.', 'chat-pay']
          : ['They pay the exact amount', 'Every order gets its own paise – like ₹798.94 for the ₹799 kurta, never more than the price – paid straight to your UPI.', 'buyer-pay'],
      ['You tap “Yes, I got it”', 'See the same amount in your UPI app? One tap. Then pack & send.', 'orders-check'],
    ],
    paiseEyebrow: 'The paise trick', paiseH: 'Why did your buyer pay ₹798.57 for a ₹799 kurta?',
    paiseP: 'Because every order gets its own paise, taken off the price – buyers never pay more than listed. Six buyers paying ₹799 look the same in your UPI app; six different amounts don’t. No screenshots, no guessing.',
    paiseAlt: 'NukkadSale Orders screen: Did you get ₹798.57 in your UPI app? Yes, I got it', paiseCap: 'The real Orders screen: each buyer’s exact amount, one tap to confirm.',
    featEyebrow: 'Features', featH: 'Everything a WhatsApp seller needs. Nothing extra.',
    feats: (bot: boolean) => [
      ['chat', bot ? 'Orders in WhatsApp' : 'One link per sale', bot ? 'Buyers order in the chat they already use. No app for them.' : 'Buyers order from your link in seconds. No app, no sign-up.'],
      ['₹', 'Exact-amount UPI', 'Every order has its own paise, so you know who paid. GPay, PhonePe, Paytm – any UPI app.'],
      ['lock', 'Never oversell', 'Stock is held for a buyer while they pay. Didn’t pay in time? It goes back on sale by itself.'],
      ['book', 'Khata that writes itself', 'Every sale is added automatically. Add courier or cash entries in one tap.'],
      ['box', 'Pack & send', 'Paid → Packed → Sent → Delivered. Copy the address in one tap.'],
      ['users', 'Know your buyers', 'Repeat buyers, total spent, one-tap WhatsApp.'],
      ['refresh', 'Sell again in one tap', 'Photos, price and sizes come back pre-filled.'],
      ['download', 'Opens like an app', 'Add it to your home screen from Chrome or Safari. No app store.'],
    ],
    payEyebrow: 'Payments', payH: 'Two ways to get paid. You choose.',
    pay: [
      ['wallet', 'UPI, straight to you', ['Buyers pay your UPI ID', 'Exact amount tells you who paid', 'One tap to confirm', 'No gateway fee'], 'Best for small sellers'],
      ['refresh', 'Automatic with Razorpay', ['Payments confirm themselves', 'Into your own Razorpay account', 'Nothing to check', 'Razorpay charges its own fee'], 'Best for busy sellers'],
    ],
    payNote: 'NukkadSale never holds your money – payments go straight to you.',
    hiEyebrow: 'हिंदी', hiH: 'In Hindi too – for you and your buyers', hiP: 'Switch English ⇄ हिंदी with one tap. Every screen, every message.',
    onbEyebrow: 'Getting started', onbH: 'We set it up with you',
    onb: [['Tell us about your business', 'Fill the short form below – takes a minute.'], ['We call you', 'We understand how you sell and set up your shop with you.'], ['Start selling', 'You get your login on WhatsApp. Post your first sale the same day.']],
    faqEyebrow: 'FAQ', faqH: 'Questions sellers ask',
    faq: (bot: boolean) => [
      ['Do my buyers need to install anything?', bot ? 'No. They order inside WhatsApp, or from your link in any browser.' : 'No. They order from your link in any browser – no app, no sign-up.'],
      ['Which payment apps work?', 'Any UPI app – GPay, PhonePe, Paytm, BHIM and others. Money goes straight to your UPI ID (or your own Razorpay account).'],
      ['Do I need a WhatsApp Business API account?', 'No. Keep selling from your own WhatsApp number and groups.'],
      ['Can I use it in Hindi?', 'Yes. The whole app – and what your buyers see – works in Hindi and English.'],
      ['How do I get my account?', 'Fill the form below. We’ll call you, set up your shop and send your login on WhatsApp. You can change your PIN anytime in Settings.'],
      ['What does it cost?', 'We’ll walk you through the plans on the call – no commitment.'],
    ],
    formEyebrow: 'Get started', formH: 'Tell us about your business', formP: 'We’ll reach out on WhatsApp, set up your shop with you and send your login.',
    f: { name: 'Your name', business: 'Shop / business name', phone: 'WhatsApp number', city: 'City', sells: 'What do you sell?', sellsPh: 'e.g. kurtis, sarees, jewellery', channel: 'Where do you sell today?', volume: 'How many orders a month?', payments: 'How would you like to get paid?', message: 'Anything else? (optional)', choose: 'Choose…', submit: 'Request a call back', consent: 'By sending this you agree to be contacted on WhatsApp or phone about NukkadSale. See our', privacy: 'privacy policy' },
    errs: { fill: 'Please fill your name, business name and WhatsApp number.', phone: 'Please enter a valid 10-digit mobile number.', many: 'Too many requests from this device today. Please message us on WhatsApp instead.' },
    thanksH: 'Thank you!', thanksP: (p: string) => `We got your request. We’ll message you on WhatsApp at ${p} soon to set up your shop.`, thanksWa: 'Message us now on WhatsApp', back: '← Back to home',
    footer: 'Sell on WhatsApp, the easy way.', policies: [['/privacy', 'Privacy'], ['/terms', 'Terms'], ['/refunds', 'Refunds'], ['/contact', 'Contact']],
  },
  hi: {
    title: 'NukkadSale – WhatsApp पर बेचिए, DM के झंझट के बिना',
    desc: 'WhatsApp ग्रुप से ऑर्डर लें, UPI पर पैसे पाएं और जानें किसने पेमेंट किया। पेमेंट होने तक स्टॉक होल्ड, खाता अपने आप। हिंदी + English।',
    nav: ['कैसे काम करता है', 'फ़ीचर', 'सवाल'], login: 'सेलर लॉग इन', cta: 'शुरू करें', other: 'English', otherLang: 'en',
    eyebrow: 'WhatsApp पर बेचने वालों के लिए',
    h1a: 'WhatsApp पर बेचिए।', h1b: 'DM के झंझट के बिना।',
    sub: (bot: boolean): string => bot
      ? 'अपने ग्रुप में प्रोडक्ट डालें। ग्राहक WhatsApp में ही ऑर्डर करें, UPI से सीधे आपको पेमेंट करें – और आपको पता रहे किसने पेमेंट किया। स्टॉक, ऑर्डर और खाता एक ऐप में।'
      : 'अपने ग्रुप में प्रोडक्ट डालें। ग्राहक आपके लिंक से सेकंडों में ऑर्डर करें, UPI से सीधे आपको पेमेंट करें – और आपको पता रहे किसने पेमेंट किया। स्टॉक, ऑर्डर और खाता एक ऐप में।',
    heroCta: 'शुरू करें – हम सेट-अप कर देंगे', heroCta2: 'देखें कैसे काम करता है',
    trust: ['हर Android और iPhone पर', 'हिंदी + English', 'पैसा सीधे आपके पास'],
    painEyebrow: 'जाना-पहचाना लगता है?', painH: 'एक डील डाली… और फ़ोन पर मैसेज की बाढ़।',
    dms: ['Price?', 'M size hai??', 'Mera hold karo pls', 'Payment kaise karu?', 'Still available??', 'COD hai?', 'Photo bhejo', 'Hello??'],
    pains: ['एक ही दाम और साइज़ 50 बार लिखना', 'पहले किसने पूछा था?', 'आख़िरी पीस 3 लोगों से वादा', 'पेमेंट के स्क्रीनशॉट ढूँढते रहना'],
    howEyebrow: 'कैसे काम करता है', howH: 'पोस्ट से पेमेंट तक – 4 कदम',
    steps: (bot: boolean) => [
      ['सेल डालें', 'फ़ोटो, दाम और साइज़ डालें। NukkadSale WhatsApp मैसेज लिख देता है – ग्रुप में शेयर करें।', 'sale-live'],
      bot ? ['ग्राहक चैट में ऑर्डर करें', 'वो आपकी पोस्ट पर टैप करें। ऑर्डर बॉट साइज़, गिनती और पता पूछता है – आप नहीं।', 'chat-product']
          : ['ग्राहक लिंक से ऑर्डर करें', 'वो आपका लिंक खोलें, साइज़ चुनें और पता डालें। कोई ऐप नहीं, कोई साइन-अप नहीं।', 'buyer-sale'],
      bot ? ['सही रकम का पेमेंट', 'हर ऑर्डर के अपने पैसे – दाम से कुछ पैसे कम, कभी ज़्यादा नहीं – तो रकम से पता चले किसने पेमेंट किया।', 'chat-pay']
          : ['सही रकम का पेमेंट', 'हर ऑर्डर के अपने पैसे – जैसे ₹799 की कुर्ती के लिए ₹798.94, दाम से कभी ज़्यादा नहीं – सीधे आपके UPI में।', 'buyer-pay'],
      ['आप टैप करें “हाँ, पैसे आ गए”', 'UPI ऐप में वही रकम दिखी? एक टैप। फिर पैक करके भेजें।', 'orders-check'],
    ],
    paiseEyebrow: 'पैसों वाली तरकीब', paiseH: '₹799 की कुर्ती के लिए ग्राहक ने ₹798.57 क्यों दिए?',
    paiseP: 'क्योंकि हर ऑर्डर के अपने पैसे होते हैं, दाम में से घटाकर – ग्राहक कभी ज़्यादा नहीं देते। छह लोग ₹799 भेजें तो UPI ऐप में सब एक जैसे दिखते हैं – छह अलग रकम नहीं। न स्क्रीनशॉट, न अंदाज़ा।',
    paiseAlt: 'NukkadSale ऑर्डर स्क्रीन: क्या आपके UPI में ₹798.57 आए?', paiseCap: 'असली ऑर्डर स्क्रीन: हर ग्राहक की सही रकम, एक टैप में पक्का।',
    featEyebrow: 'फ़ीचर', featH: 'WhatsApp सेलर को जो चाहिए, बस वही।',
    feats: (bot: boolean) => [
      ['chat', bot ? 'WhatsApp में ऑर्डर' : 'हर सेल का एक लिंक', bot ? 'ग्राहक उसी चैट में ऑर्डर करें जो वो रोज़ चलाते हैं। उनके लिए कोई ऐप नहीं।' : 'ग्राहक आपके लिंक से सेकंडों में ऑर्डर करें। कोई ऐप नहीं, कोई साइन-अप नहीं।'],
      ['₹', 'सही रकम वाला UPI', 'हर ऑर्डर के अपने पैसे, तो पता रहे किसने पेमेंट किया। GPay, PhonePe, Paytm – कोई भी UPI ऐप।'],
      ['lock', 'कभी ज़्यादा न बिके', 'पेमेंट होने तक स्टॉक ग्राहक के लिए होल्ड। समय पर पेमेंट नहीं? अपने आप फिर से बिक्री में।'],
      ['book', 'खाता अपने आप', 'हर बिक्री अपने आप जुड़ती है। कूरियर या कैश एक टैप में जोड़ें।'],
      ['box', 'पैक करके भेजें', 'पेमेंट → पैक → भेजा → पहुँचा। पता एक टैप में कॉपी।'],
      ['users', 'अपने ग्राहक पहचानें', 'बार-बार आने वाले ग्राहक, कुल ख़रीद, एक टैप में WhatsApp।'],
      ['refresh', 'एक टैप में फिर से बेचें', 'फ़ोटो, दाम और साइज़ पहले से भरे मिलते हैं।'],
      ['download', 'ऐप की तरह खुलता है', 'Chrome या Safari से होम स्क्रीन पर जोड़ें। ऐप स्टोर की ज़रूरत नहीं।'],
    ],
    payEyebrow: 'पेमेंट', payH: 'पैसे लेने के दो तरीके। आप चुनें।',
    pay: [
      ['wallet', 'UPI, सीधे आपको', ['ग्राहक आपकी UPI ID पर भेजें', 'सही रकम से पता चले किसने भेजा', 'एक टैप में पक्का', 'कोई गेटवे फ़ीस नहीं'], 'छोटे सेलर के लिए सबसे अच्छा'],
      ['refresh', 'Razorpay से अपने आप', ['पेमेंट अपने आप पक्का', 'आपके अपने Razorpay खाते में', 'कुछ चेक नहीं करना', 'Razorpay अपनी फ़ीस लेता है'], 'ज़्यादा ऑर्डर वालों के लिए'],
    ],
    payNote: 'NukkadSale आपका पैसा कभी नहीं रखता – पेमेंट सीधे आपके पास जाता है।',
    hiEyebrow: 'English', hiH: 'आपके और आपके ग्राहकों के लिए हिंदी में', hiP: 'एक टैप में English ⇄ हिंदी। हर स्क्रीन, हर मैसेज।',
    onbEyebrow: 'शुरुआत', onbH: 'हम आपके साथ सेट-अप करेंगे',
    onb: [['अपने काम के बारे में बताएं', 'नीचे छोटा फ़ॉर्म भरें – एक मिनट लगेगा।'], ['हम आपको कॉल करेंगे', 'समझेंगे आप कैसे बेचते हैं और आपके साथ दुकान सेट करेंगे।'], ['बेचना शुरू करें', 'लॉग इन WhatsApp पर मिलेगा। उसी दिन पहली सेल डालें।']],
    faqEyebrow: 'सवाल', faqH: 'सेलर अक्सर पूछते हैं',
    faq: (bot: boolean) => [
      ['क्या ग्राहकों को कुछ इंस्टॉल करना होगा?', bot ? 'नहीं। वो WhatsApp में ही ऑर्डर करें, या किसी भी ब्राउज़र में आपके लिंक से।' : 'नहीं। वो किसी भी ब्राउज़र में आपके लिंक से ऑर्डर करें – कोई ऐप नहीं, कोई साइन-अप नहीं।'],
      ['कौन से पेमेंट ऐप चलते हैं?', 'कोई भी UPI ऐप – GPay, PhonePe, Paytm, BHIM वग़ैरह। पैसा सीधे आपकी UPI ID (या आपके अपने Razorpay खाते) में।'],
      ['क्या WhatsApp Business API खाता चाहिए?', 'नहीं। अपने ही WhatsApp नंबर और ग्रुप से बेचते रहें।'],
      ['क्या हिंदी में चलेगा?', 'हाँ। पूरा ऐप – और जो आपके ग्राहक देखते हैं – हिंदी और English दोनों में।'],
      ['मेरा खाता कैसे बनेगा?', 'नीचे फ़ॉर्म भरें। हम कॉल करके आपकी दुकान सेट करेंगे और लॉग इन WhatsApp पर भेजेंगे। PIN आप कभी भी सेटिंग में बदल सकते हैं।'],
      ['इसका ख़र्च कितना है?', 'कॉल पर हम प्लान समझा देंगे – कोई बाध्यता नहीं।'],
    ],
    formEyebrow: 'शुरू करें', formH: 'अपने काम के बारे में बताएं', formP: 'हम WhatsApp पर संपर्क करेंगे, आपके साथ दुकान सेट करेंगे और लॉग इन भेजेंगे।',
    f: { name: 'आपका नाम', business: 'दुकान / बिज़नेस का नाम', phone: 'WhatsApp नंबर', city: 'शहर', sells: 'आप क्या बेचते हैं?', sellsPh: 'जैसे कुर्ती, साड़ी, ज्वेलरी', channel: 'अभी कहाँ बेचते हैं?', volume: 'महीने में कितने ऑर्डर?', payments: 'पैसे कैसे लेना चाहेंगे?', message: 'कुछ और? (ज़रूरी नहीं)', choose: 'चुनें…', submit: 'कॉल बैक माँगें', consent: 'भेजकर आप NukkadSale के बारे में WhatsApp या फ़ोन पर संपर्क के लिए सहमत हैं। देखें हमारी', privacy: 'प्राइवेसी पॉलिसी' },
    errs: { fill: 'कृपया नाम, बिज़नेस का नाम और WhatsApp नंबर भरें।', phone: 'कृपया सही 10 अंकों का मोबाइल नंबर डालें।', many: 'आज इस फ़ोन से बहुत सारे फ़ॉर्म आ चुके। कृपया WhatsApp पर मैसेज करें।' },
    thanksH: 'धन्यवाद!', thanksP: (p: string) => `आपकी जानकारी मिल गई। दुकान सेट करने के लिए हम जल्द ही ${p} पर WhatsApp करेंगे।`, thanksWa: 'अभी WhatsApp पर मैसेज करें', back: '← होम पर वापस',
    footer: 'WhatsApp पर बेचिए, आसानी से।', policies: [['/privacy', 'प्राइवेसी'], ['/terms', 'शर्तें'], ['/refunds', 'रिफ़ंड'], ['/contact', 'संपर्क']],
  },
}
type Copy = (typeof C)['en'] | (typeof C)['hi']

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
nav.links a{text-decoration:none;font-weight:600;color:var(--muted)}
nav.links a:hover{color:var(--ink)}
.hgap{flex:1}
.lang{font-weight:700;text-decoration:none;color:var(--muted);font-size:.95rem}
.login{font-weight:700;text-decoration:none;font-size:.95rem}
section{padding:72px 0}
.eyebrow{display:inline-block;font-weight:800;font-size:.85rem;letter-spacing:.06em;text-transform:uppercase;color:var(--brand);margin-bottom:10px}
h1{font-size:clamp(2.3rem,6vw,4rem);line-height:1.04;letter-spacing:-1.5px;font-weight:900}
h2{font-size:clamp(1.8rem,4vw,2.6rem);line-height:1.1;letter-spacing:-1px;font-weight:900;margin-bottom:14px}
h3{font-size:1.15rem;font-weight:800;margin-bottom:6px}
.lead{font-size:1.15rem;color:var(--muted);max-width:620px}
.center{text-align:center}.center .lead{margin:0 auto}
.hero{padding:56px 0 40px;background:radial-gradient(circle at 85% 10%,#ffe3cf,transparent 45%),radial-gradient(circle at 5% 90%,#fff0e2,transparent 40%)}
.hero .wrap{display:grid;grid-template-columns:1.1fr .9fr;gap:40px;align-items:center}
.hero h1 span{color:var(--brand)}
.hero .lead{margin:18px 0 26px}
.ctas{display:flex;gap:12px;flex-wrap:wrap}
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
.feat{background:#fff;border:1px solid var(--line);border-radius:22px;padding:22px}
.feat .ic{width:46px;height:46px;border-radius:14px;background:var(--soft);display:flex;align-items:center;justify-content:center;font-size:1.4rem;font-weight:900;color:var(--brand);margin-bottom:12px}
.feat p{color:var(--muted);font-size:.95rem}
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
details{background:#fff;border:1px solid var(--line);border-radius:18px;padding:18px 22px}
summary{font-weight:800;cursor:pointer;list-style:none;display:flex;justify-content:space-between;gap:12px}
summary::-webkit-details-marker{display:none}
summary:after{content:"+";font-size:1.4rem;line-height:1;color:var(--brand)}
details[open] summary:after{content:"–"}
details p{color:var(--muted);margin-top:10px}
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
@media (max-width:900px){
  nav.links{display:none}
  .hero .wrap,.pain .wrap,.paise .wrap,.hindi .wrap,.formsec .wrap{grid-template-columns:1fr}
  .phones{height:470px;max-width:440px;margin:0 auto;width:100%}
  .phone{width:205px}
  .steps,.grid{grid-template-columns:1fr 1fr}
  .onb,.pay{grid-template-columns:1fr}
  section{padding:56px 0}
}
@media (max-width:560px){
  header .wrap{gap:10px}.login{display:none}header .btn.sm{white-space:nowrap}
  .steps,.grid,.fields{grid-template-columns:1fr}
  .step .shot{aspect-ratio:9/11}
  .phones{height:420px}.phone{width:180px}.phones .p1{left:0}.phones .p2{right:0}
  .duo .phone{width:46%}
  .ctas .btn{width:100%}
}@media (max-width:380px){
  header .wrap{gap:8px}.logo{font-size:1.02rem;gap:6px}header .btn.sm{padding:0 10px;font-size:.85rem}
}
@media (max-width:340px){
  header .wrap{padding-left:12px;padding-right:12px}
}

`

const Logo = () => <a class="logo" href="/"><i><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5.2 3h13.6L21 9a3 3 0 0 1-6 0 3 3 0 0 1-6 0 3 3 0 0 1-6 0z" fill="#fff" stroke-width="1.4" /><path d="M5 12.6V21h14v-8.4M10 21v-5h4v5" /></svg></i>NukkadSale</a>
const Phone = (p: { img: string; cls?: string; alt: string }) => <div class={`phone ${p.cls ?? ''}`}><img src={`/site/${p.img}.webp`} alt={p.alt} loading="lazy" width="540" height="1169" /></div>

function Page(p: { c: Context<AppEnv>; k: Copy; lang: 'en' | 'hi'; back: string; children: Child }) {
  const origin = new URL(p.c.req.url).origin
  return (
    <html lang={p.lang}>
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover" />
        <title>{p.k.title}</title>
        <meta name="description" content={p.k.desc} />
        <meta name="theme-color" content="#e2560c" />
        <link rel="icon" href="/icon-192.png" />
        <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
        <link rel="canonical" href={`${origin}/`} />
        <meta property="og:type" content="website" />
        <meta property="og:title" content={p.k.title} />
        <meta property="og:description" content={p.k.desc} />
        <meta property="og:image" content={`${origin}/site/og.jpg`} />
        <meta property="og:url" content={`${origin}/`} />
        <meta name="twitter:card" content="summary_large_image" />
        <style>{raw(CSS)}</style>
      </head>
      <body>
        <header>
          <div class="wrap">
            <Logo />
            <nav class="links"><a href="/#how">{p.k.nav[0]}</a><a href="/#features">{p.k.nav[1]}</a><a href="/#faq">{p.k.nav[2]}</a></nav>
            <span class="hgap" />
            <a class="lang" href={`/lang?to=${p.k.otherLang}&back=${encodeURIComponent(p.back)}`} lang={p.k.otherLang}>{p.k.other}</a>
            <a class="login" href="/login">{p.k.login}</a>
            <a class="btn primary sm" href="/#get-started">{p.k.cta}</a>
          </div>
        </header>
        <main>{p.children}</main>
        <footer>
          <div class="wrap">
            <div><Logo /><p style="margin-top:6px">{p.k.footer}</p></div>
            <nav>{p.k.policies.map(([href, l]) => <a href={href}>{l}</a>)}<a href="/login">{p.k.login}</a></nav>
          </div>
        </footer>
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

site.get('/', async (c) => {
  if (await currentSeller(c)) return c.redirect('/app')
  const lang = getLang(c), k = C[lang], bot = waBotEnabled(c.env)
  const err = c.req.query('err')
  return c.html('<!doctype html>' + (
    <Page c={c} k={k} lang={lang} back="/">
      <section class="hero">
        <div class="wrap">
          <div>
            <span class="eyebrow">{k.eyebrow}</span>
            <h1>{k.h1a}<br /><span>{k.h1b}</span></h1>
            <p class="lead">{k.sub(bot)}</p>
            <div class="ctas"><a class="btn primary" href="#get-started">{k.heroCta}</a><a class="btn ghost" href="#how">{k.heroCta2}</a></div>
            <div class="trust">{k.trust.map((x) => <span>{x}</span>)}</div>
          </div>
          <div class="phones" aria-hidden="true">
            <Phone img={bot ? 'chat-pay' : 'buyer-sale'} cls="p1" alt="" />
            <Phone img={lang === 'hi' ? 'home-hi' : 'home'} cls="p2" alt="" />
          </div>
        </div>
      </section>

      <section class="dark pain">
        <div class="wrap">
          <div>
            <span class="eyebrow">{k.painEyebrow}</span>
            <h2>{k.painH}</h2>
            <ul class="pains">{k.pains.map((x) => <li>{x}</li>)}</ul>
          </div>
          <div><span class="badge">99+ unread</span><div class="dms">{k.dms.map((d) => <span class="dm">{d}</span>)}</div></div>
        </div>
      </section>

      <section id="how">
        <div class="wrap">
          <div class="center"><span class="eyebrow">{k.howEyebrow}</span><h2>{k.howH}</h2></div>
          <div class="steps">
            {k.steps(bot).map(([h, p, img], i) => (
              <div class="step"><span class="n">{i + 1}</span><h3>{h}</h3><p>{p}</p><div class="shot"><img src={`/site/${img}.webp`} alt={h} loading="lazy" width="540" height="1169" /></div></div>
            ))}
          </div>
        </div>
      </section>

      <section class="green paise">
        <div class="wrap">
          <div>
            <span class="eyebrow" style="color:#ffd43b">{k.paiseEyebrow}</span>
            <div class="big">₹798<span>.57</span></div>
            <h2 style="margin-top:16px">{k.paiseH}</h2>
            <p class="lead">{k.paiseP}</p>
          </div>
          <figure class="cards"><img src="/site/paise-cards.webp" alt={k.paiseAlt} loading="lazy" width="600" height="849" /><figcaption>{k.paiseCap}</figcaption></figure>
        </div>
      </section>

      <section id="features">
        <div class="wrap">
          <div class="center"><span class="eyebrow">{k.featEyebrow}</span><h2>{k.featH}</h2></div>
          <div class="grid">{k.feats(bot).map(([ic, h, p]) => <div class="feat"><div class="ic">{svgIcon(ic as string)}</div><h3>{h}</h3><p>{p}</p></div>)}</div>
        </div>
      </section>

      <section style="background:var(--soft)">
        <div class="wrap center">
          <span class="eyebrow">{k.payEyebrow}</span><h2>{k.payH}</h2>
          <div class="pay" style="text-align:left">
            {k.pay.map(([ic, h, items, tag]) => (
              <div class="paycard"><div class="ic">{svgIcon(ic as string, 30)}</div><h3 style="font-size:1.35rem">{h}</h3><ul>{(items as string[]).map((x) => <li>{x}</li>)}</ul><span class="tag">{tag}</span></div>
            ))}
          </div>
          <p class="note">{k.payNote}</p>
        </div>
      </section>

      <section class="hindi">
        <div class="wrap">
          <div><span class="eyebrow">{k.hiEyebrow}</span><h2>{k.hiH}</h2><p class="lead">{k.hiP}</p></div>
          <div class="duo"><Phone img="home" alt="English" /><Phone img="home-hi" alt="हिंदी" /></div>
        </div>
      </section>

      <section style="padding-top:20px">
        <div class="wrap">
          <div class="center"><span class="eyebrow">{k.onbEyebrow}</span><h2>{k.onbH}</h2></div>
          <div class="onb">{k.onb.map(([h, p], i) => <div><b>{i + 1}</b><h3>{h}</h3><p>{p}</p></div>)}</div>
        </div>
      </section>

      <section id="faq" style="padding-top:20px">
        <div class="wrap">
          <div class="center"><span class="eyebrow">{k.faqEyebrow}</span><h2>{k.faqH}</h2></div>
          <div class="faq">{k.faq(bot).map(([q, a]) => <details><summary>{q}</summary><p>{a}</p></details>)}</div>
        </div>
      </section>

      <section class="formsec" id="get-started">
        <div class="wrap">
          <div>
            <span class="eyebrow" style="color:#ffe8d9">{k.formEyebrow}</span>
            <h2>{k.formH}</h2>
            <p class="lead">{k.formP}</p>
          </div>
          <form class="card" method="post" action="/get-started">
            {err && <div class="err">{err}</div>}
            <div class="fields">
              <div><label for="name">{k.f.name}</label><input id="name" name="name" autocomplete="name" required maxlength={60} /></div>
              <div><label for="business">{k.f.business}</label><input id="business" name="business" required maxlength={80} /></div>
              <div><label for="phone">{k.f.phone}</label><div class="tel"><span>+91</span><input id="phone" name="phone" type="tel" inputmode="numeric" autocomplete="tel-national" maxlength={14} placeholder="98XXXXXXXX" required /></div></div>
              <div><label for="city">{k.f.city}</label><input id="city" name="city" autocomplete="address-level2" maxlength={60} /></div>
              <div><label for="sells">{k.f.sells}</label><input id="sells" name="sells" placeholder={k.f.sellsPh} maxlength={120} /></div>
              <div><label for="channel">{k.f.channel}</label><select id="channel" name="channel"><Options map={CHANNELS} lang={lang} placeholder={k.f.choose} /></select></div>
              <div><label for="volume">{k.f.volume}</label><select id="volume" name="volume"><Options map={VOLUMES} lang={lang} placeholder={k.f.choose} /></select></div>
              <div><label for="payments">{k.f.payments}</label><select id="payments" name="payments"><Options map={PAYMENTS} lang={lang} placeholder={k.f.choose} /></select></div>
            </div>
            <div><label for="message">{k.f.message}</label><textarea id="message" name="message" maxlength={1000} /></div>
            <div class="hp" aria-hidden="true"><label for="website">Website</label><input id="website" name="website" tabindex={-1} autocomplete="off" /></div>
            <button class="btn primary" type="submit" style="width:100%;min-height:54px;font-size:1.05rem">{k.f.submit}</button>
            <p class="consent">{k.f.consent} <a href="/privacy">{k.f.privacy}</a>.</p>
          </form>
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
