import { Hono } from 'hono'
import type { AppEnv } from '../env'
import { tr } from '../i18n'
import { waLink } from '../lib/util'
import { Icon, Layout } from '../views/layout'
import { here } from './public'

/*
 * Step-by-step guide for a seller to get Razorpay keys – public, so the admin can WhatsApp the
 * link before the onboarding call. Razorpay's dashboard labels change now and then, so the steps
 * name the screen and what's on it rather than exact pixel positions.
 */
export const guide = new Hono<AppEnv>()

const G = {
  en: {
    title: 'Get your Razorpay keys',
    lead: 'Razorpay lets your buyers pay by UPI, card or net banking, and NukkadSale marks the order paid by itself – no checking. The money goes into your own bank account. Takes about 20 minutes, plus Razorpay’s approval time.',
    keep: 'Keep these ready',
    docs: ['PAN card (yours, or your business’s)', 'Aadhaar linked to your mobile number (for e-KYC)', 'Bank account number and IFSC where you want the money', 'GST number – only if you have one (not needed for individuals)', 'Your NukkadSale shop link – it’s on your NukkadSale home screen (Settings → share)'],
    parts: [
      ['Part 1 – Sign up (5 min)', [
        'Open razorpay.com on your phone or laptop and tap Sign Up.',
        'Use your own mobile number and email – the account must be in your name or your business’s name, not someone else’s.',
        'Enter the OTPs sent to your mobile and email.',
      ]],
      ['Part 2 – Activate your account / KYC (15 min)', [
        'In the Razorpay dashboard, tap Activate account (or Complete KYC).',
        'Business type: choose Individual if you sell in your own name, or Proprietorship if you have a registered shop. Unregistered is fine.',
        'Business category: pick what you sell, for example Fashion & lifestyle.',
        'Enter your PAN, your business name and address.',
        'Bank details: account number and IFSC of the account where you want payments.',
        'Website / app: if asked, choose the option for selling without a website or on social media, or enter your NukkadSale shop link.',
        'Finish e-KYC (Aadhaar OTP) or upload the documents it asks for, then Submit.',
      ]],
      ['Part 3 – Wait for approval', [
        'Razorpay usually takes a few working days. Watch your email – they sometimes ask for one more document.',
        'Keep selling on UPI in NukkadSale meanwhile. Nothing changes for your buyers.',
      ]],
      ['Part 4 – Generate your live keys (2 min)', [
        'Once approved, open the Razorpay dashboard and switch to Live mode (the switch is at the top of the dashboard).',
        'Go to Account & Settings → API Keys (under Website and app settings).',
        'Tap Generate Key (or Regenerate). Razorpay shows a Key ID that starts with rzp_live_ and a Key Secret.',
        'Copy both now, or download them – the Key Secret is shown only once.',
      ]],
      ['Part 5 – Put the keys in NukkadSale (1 min)', [
        'Open NukkadSale → Settings → How you get paid.',
        'Choose Razorpay, paste the Key ID and the Key Secret, and tap Save. No webhook is needed.',
        'Don’t see Razorpay there? Tap Request – we switch it on for your shop.',
      ]],
      ['Part 6 – Test with ₹10', [
        'Create a small ₹10 sale, order it from another phone and pay.',
        'Within about a minute the order shows Paid in NukkadSale – nobody taps anything.',
        'Refund it in Razorpay: Transactions → Payments → open the payment → Refund.',
      ]],
    ],
    tipsT: 'Good to know',
    tips: ['Razorpay charges its own fee on each payment (about 2%) and sends the rest to your bank, usually within 2 working days.', 'Never send your Key Secret on WhatsApp or to anyone – paste it only into NukkadSale, where it’s stored encrypted.', 'If you think your Key Secret leaked, generate a new key in the same place and paste the new one into NukkadSale. The old one stops working.', 'Refunds and disputes are handled in your Razorpay dashboard.'],
    help: 'Stuck on a step? Message us',
    helpMsg: 'Hi, I need help getting my Razorpay keys for NukkadSale.',
  },
  hi: {
    title: 'अपनी Razorpay keys कैसे पाएं',
    lead: 'Razorpay से ग्राहक UPI, कार्ड या नेट बैंकिंग से पेमेंट करते हैं, और NukkadSale ऑर्डर अपने आप पक्का कर देता है – कुछ चेक नहीं करना। पैसा आपके अपने बैंक खाते में जाता है। लगभग 20 मिनट, और Razorpay की मंज़ूरी का समय।',
    keep: 'ये तैयार रखें',
    docs: ['PAN कार्ड (आपका या आपके बिज़नेस का)', 'मोबाइल नंबर से जुड़ा आधार (e-KYC के लिए)', 'बैंक खाता नंबर और IFSC जहाँ पैसा चाहिए', 'GST नंबर – सिर्फ़ अगर है (व्यक्तिगत के लिए ज़रूरी नहीं)', 'आपकी NukkadSale दुकान का लिंक – NukkadSale होम स्क्रीन पर मिलेगा'],
    parts: [
      ['भाग 1 – साइन-अप (5 मिनट)', [
        'फ़ोन या लैपटॉप पर razorpay.com खोलें और Sign Up दबाएं।',
        'अपना ही मोबाइल नंबर और ईमेल डालें – खाता आपके या आपके बिज़नेस के नाम पर होना चाहिए, किसी और के नहीं।',
        'मोबाइल और ईमेल पर आए OTP डालें।',
      ]],
      ['भाग 2 – खाता चालू करें / KYC (15 मिनट)', [
        'Razorpay डैशबोर्ड में Activate account (या Complete KYC) दबाएं।',
        'Business type: अपने नाम से बेचते हैं तो Individual, रजिस्टर्ड दुकान है तो Proprietorship चुनें। बिना रजिस्ट्रेशन भी चलेगा।',
        'Business category: जो बेचते हैं वो चुनें, जैसे Fashion & lifestyle।',
        'अपना PAN, बिज़नेस का नाम और पता डालें।',
        'बैंक डिटेल: उस खाते का नंबर और IFSC जहाँ पेमेंट चाहिए।',
        'Website / app: पूछे तो बिना वेबसाइट / सोशल मीडिया पर बेचने वाला विकल्प चुनें, या अपनी NukkadSale दुकान का लिंक डालें।',
        'e-KYC (आधार OTP) पूरा करें या माँगे गए डॉक्यूमेंट अपलोड करें, फिर Submit दबाएं।',
      ]],
      ['भाग 3 – मंज़ूरी का इंतज़ार', [
        'Razorpay आमतौर पर कुछ कामकाजी दिन लेता है। ईमेल देखते रहें – कभी-कभी एक और डॉक्यूमेंट माँगते हैं।',
        'तब तक NukkadSale में UPI से बेचते रहें। ग्राहकों के लिए कुछ नहीं बदलता।',
      ]],
      ['भाग 4 – Live keys बनाएं (2 मिनट)', [
        'मंज़ूरी के बाद Razorpay डैशबोर्ड खोलें और Live mode पर करें (स्विच डैशबोर्ड में ऊपर है)।',
        'Account & Settings → API Keys पर जाएं (Website and app settings के नीचे)।',
        'Generate Key (या Regenerate) दबाएं। Razorpay एक Key ID (rzp_live_ से शुरू) और एक Key Secret दिखाएगा।',
        'दोनों अभी कॉपी कर लें या डाउनलोड करें – Key Secret सिर्फ़ एक बार दिखता है।',
      ]],
      ['भाग 5 – Keys NukkadSale में डालें (1 मिनट)', [
        'NukkadSale खोलें → सेटिंग → पैसे कैसे लेंगे।',
        'Razorpay चुनें, Key ID और Key Secret पेस्ट करें, Save दबाएं। Webhook की ज़रूरत नहीं।',
        'वहाँ Razorpay नहीं दिख रहा? अनुरोध दबाएं – हम आपकी दुकान के लिए चालू कर देंगे।',
      ]],
      ['भाग 6 – ₹10 से टेस्ट करें', [
        '₹10 की छोटी सेल बनाएं, दूसरे फ़ोन से ऑर्डर करके पेमेंट करें।',
        'लगभग एक मिनट में NukkadSale में ऑर्डर “पेमेंट आया” दिखेगा – कोई टैप नहीं।',
        'Razorpay में रिफ़ंड करें: Transactions → Payments → पेमेंट खोलें → Refund।',
      ]],
    ],
    tipsT: 'ज़रूरी बातें',
    tips: ['Razorpay हर पेमेंट पर अपनी फ़ीस (लगभग 2%) लेता है और बाकी पैसा आमतौर पर 2 कामकाजी दिन में आपके बैंक में भेजता है।', 'Key Secret कभी WhatsApp पर या किसी को न भेजें – सिर्फ़ NukkadSale में पेस्ट करें, जहाँ यह सुरक्षित (encrypted) रखा जाता है।', 'Key Secret लीक होने का शक हो तो उसी जगह नई key बनाएं और NukkadSale में नई पेस्ट करें। पुरानी काम करना बंद कर देगी।', 'रिफ़ंड और विवाद आपके Razorpay डैशबोर्ड में संभाले जाते हैं।'],
    help: 'किसी कदम पर अटके? मैसेज करें',
    helpMsg: 'नमस्ते, NukkadSale के लिए Razorpay keys पाने में मदद चाहिए।',
  },
}

guide.get('/help/razorpay', (c) => {
  const t = tr(c)
  const g = G[t.lang]
  return c.html(
    <Layout t={t} path={here(c)} title={`${g.title} – NukkadSale`}>
      <article class="legal">
        <h1>{g.title}</h1>
        <p>{g.lead}</p>
        <h2>{g.keep}</h2>
        <ul>{g.docs.map((d) => <li>{d}</li>)}</ul>
        {g.parts.map(([h, steps]) => (
          <>
            <h2>{h}</h2>
            <ol>{(steps as string[]).map((s) => <li>{s}</li>)}</ol>
          </>
        ))}
        <h2>{g.tipsT}</h2>
        <ul>{g.tips.map((x) => <li>{x}</li>)}</ul>
        {c.env.SUPPORT_PHONE && <a class="btn wa block" href={waLink(c.env.SUPPORT_PHONE, g.helpMsg)} style="margin-top:20px"><Icon n="chat" s={18} />{g.help}</a>}
      </article>
    </Layout>,
  )
})
