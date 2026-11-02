// Caption backgrounds for the showcase (1920×1080): one per scene, plus chapter and intro/outro cards.
import { chromium } from 'playwright'
import fs from 'node:fs'
const OUT = process.env.OUT
const { scenes } = JSON.parse(fs.readFileSync(OUT + '/scenes.json', 'utf8'))
export const SECTIONS = {
  small: { tag: 'SMALL SELLER · UPI', color: '#d9480f', title: 'For small sellers', sub: 'Buyers pay straight to your UPI ID. You confirm with one tap.', icon: '🛍' },
  buyer: { tag: 'BUYER', color: '#1f7a52', title: 'For buyers', sub: 'Order inside WhatsApp or on any phone browser. No app, no login.', icon: '🙋‍♀️' },
  manage: { tag: 'RUNNING THE SHOP', color: '#1864ab', title: 'Running your shop', sub: 'Orders, packing, chats, khata and customers – in one place.', icon: '📦' },
  big: { tag: 'BIG SELLER · GATEWAY', color: '#6741d9', title: 'For big sellers', sub: 'Connect a payment gateway. Every payment confirms itself.', icon: '⚡' },
}
const C = {
  's-signup': ['Sign up in under a minute', 'Name, shop, UPI ID and a PIN – and choose how you want to get paid.'],
  's-home': ['A guided start', 'New sellers see exactly what to do first.'],
  's-upi': ['More than one UPI ID', 'Shop and personal UPI IDs – choose which one each sale uses.'],
  's-newsale': ['Post a sale in a minute', 'Up to 5 photos, price, sizes and stock. Photos are made light for mobile data.'],
  's-share': ['Share to your groups', 'Photos and caption together, with an order link (on phones that support sharing photos). Or copy the message.'],
  'b-group': ['It starts in the seller’s group', 'The seller’s usual post – photo, caption and an order link instead of “DM me”. The buyer taps the link.'],
  'b-chat': ['A private chat opens – not in the group', 'A 1-to-1 chat with the ordering number opens with the order typed in. The bot’s real replies: size, address, payment, “more” items – one payment.'],
  'b-web': ['Or order on the website', 'Swipe photos, pick a size, pay by UPI. Stock counts stay private.'],
  'b-browse': ['Browse the whole shop', 'From any sale link, see the shop’s other items. Anything added joins the same payment.'],
  'm-home': ['Home is a to-do list', 'What to check, pack and send – plus the week at a glance.'],
  'm-check': ['Confirm in one tap', 'The exact amount tells you who paid. One tap confirms the whole order – even with 2 items.'],
  'm-chat2': ['The buyer is told in WhatsApp', 'The messages the bot sent when the seller tapped “Yes” and “Packed”.'],
  'm-send': ['Pack & send', 'Paid → Packed → Sent → Delivered. Copy the address in one tap.'],
  'm-quick': ['Order from a chat', 'Buyer messaged you directly? Pick the items – get a ready message with the exact amount and pay link.'],
  'm-khata': ['A khata that writes itself', 'Every sale is added automatically. Add courier or cash entries anytime.'],
  'm-buyers': ['Know your buyers', 'Repeat buyers, total spent, one-tap WhatsApp and contact export.'],
  'm-again': ['Sell again in one tap', 'Photos, price and sizes come back pre-filled.'],
  'm-hindi': ['हिंदी in one tap', 'Seller and buyer screens in Hindi or English.'],
  'm-install': ['Opens like an app', 'Install from Chrome on Android, or Safari on iPhone (Share → Add to Home Screen).'],
  'g-signup': ['Big seller? Choose automatic', 'Pick automatic payments right at signup.'],
  'g-connect': ['Connect your payment gateway', 'Paste your Razorpay keys once. Money goes to your own Razorpay account.'],
  'g-buyer': ['The buyer pays on the gateway', 'Test-mode checkout shown – real buyers see your gateway’s own checkout. Confirmed automatically.'],
  'g-seller': ['Nothing to check', 'Orders arrive already paid – straight to packing.'],
}
const base = `body{margin:0;width:1920px;height:1080px;font-family:system-ui,"Noto Sans","Noto Sans Devanagari",sans-serif;background:radial-gradient(circle at 15% 20%,#fff1e8,#faf7f2 55%,#f3e7d8);color:#1d1a16;overflow:hidden;position:relative}`
const phoneSlot = `<div style="position:absolute;left:1236px;top:44px;width:456px;height:984px;border-radius:52px;background:#1d1a16;box-shadow:0 40px 80px rgba(80,40,10,.25)"></div>`
const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1920, height: 1080 } })
const order = Object.keys(SECTIONS)
for (const sc of scenes.filter((x) => C[x.key])) {
  const [title, sub] = C[sc.key], sec = SECTIONS[sc.section]
  const inSec = scenes.filter((x) => x.section === sc.section && C[x.key]), n = inSec.indexOf(sc) + 1
  const chapters = order.map((k) => `<span style="display:inline-block;padding:8px 18px;border-radius:99px;margin-right:10px;font-size:22px;font-weight:700;${k === sc.section ? `background:${SECTIONS[k].color};color:#fff` : 'background:#ece4d8;color:#8a8075'}">${SECTIONS[k].title.replace('For ', '').replace('Running your shop', 'Your shop')}</span>`).join('')
  await p.setContent(`<style>${base}</style>${phoneSlot}
  <div style="position:absolute;left:140px;top:80px;font-size:34px;font-weight:800">NukkadSale</div>
  <div style="position:absolute;left:140px;top:330px;width:980px">
    <div style="display:inline-block;background:${sec.color};color:#fff;font-weight:800;font-size:24px;letter-spacing:1px;padding:8px 18px;border-radius:10px;margin-bottom:22px">${sec.tag} · ${n}/${inSec.length}</div>
    <div style="font-size:74px;font-weight:800;line-height:1.08;margin-bottom:26px">${title}</div>
    <div style="font-size:38px;line-height:1.4;color:#5a5249">${sub}</div>
  </div>
  <div style="position:absolute;left:140px;bottom:80px">${chapters}</div>`)
  await p.screenshot({ path: `${OUT}/card-${sc.key}.png` })
}
for (const [k, sec] of Object.entries(SECTIONS)) {
  await p.setContent(`<style>${base}</style><div style="position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;background:linear-gradient(160deg,${sec.color},#1d1a16 140%);color:#fff">
    <div style="font-size:130px">${sec.icon}</div><div style="font-size:30px;font-weight:800;letter-spacing:3px;opacity:.85;margin-top:10px">CHAPTER ${order.indexOf(k) + 1}</div>
    <div style="font-size:110px;font-weight:900;margin-top:6px">${sec.title}</div><div style="font-size:44px;margin-top:18px;opacity:.95;max-width:1300px">${sec.sub}</div></div>`)
  await p.screenshot({ path: `${OUT}/section-${k}.png` })
}
await p.setContent(`<style>${base}</style><div style="position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center">
  <div><svg viewBox="0 0 24 24" width="150" height="150" fill="none" stroke="#d9480f" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5.2 3h13.6L21 9a3 3 0 0 1-6 0 3 3 0 0 1-6 0 3 3 0 0 1-6 0z" fill="#d9480f" stroke-width="1.4"/><path d="M5 12.6V21h14v-8.4M10 21v-5h4v5"/></svg></div><div style="font-size:120px;font-weight:800">NukkadSale</div>
  <div style="font-size:46px;color:#5a5249;margin-top:16px">Sell on WhatsApp. Get paid on UPI. Never oversell.</div>
  <div style="font-size:32px;color:#d9480f;font-weight:700;margin-top:40px">Full product tour · small sellers · buyers · big sellers</div></div>`)
await p.screenshot({ path: `${OUT}/intro.png` })
await p.setContent(`<style>${base}</style><div style="position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center">
  <div style="font-size:100px;font-weight:800">NukkadSale</div>
  <div style="font-size:44px;color:#5a5249;margin-top:18px">Sell on WhatsApp. Get paid on UPI. Never oversell.</div>
  <div style="margin-top:40px">${['Small & big sellers', 'WhatsApp ordering', 'Several items, one payment', 'हिंदी + English', 'Works in your phone’s browser'].map((x) => `<span style="display:inline-block;background:#fff;border:2px solid #e6dfd2;border-radius:99px;padding:12px 26px;font-size:30px;font-weight:700;margin:8px">${x}</span>`).join('')}</div></div>`)
await p.screenshot({ path: `${OUT}/outro.png` })
await b.close(); console.log('cards done')
