import { Hono } from 'hono'
import type { Context } from 'hono'
import type { Child } from 'hono/jsx'
import type { AppEnv } from '../env'
import { tr } from '../i18n'
import { normalizePhone, waLink } from '../lib/util'
import { Flash, Layout, PhoneInput } from '../views/layout'
import { here } from './public'

/*
 * Privacy policy, terms, refund & cancellation, contact and a data-request form.
 * Written to describe what the app actually does with data. Business details come from
 * LEGAL_NAME / LEGAL_ADDRESS / SUPPORT_EMAIL / SUPPORT_PHONE. Not legal advice – have a
 * lawyer review before a wide launch.
 */
export const legal = new Hono<AppEnv>()

const UPDATED = '1 November 2026'

function biz(c: Context<AppEnv>) {
  return {
    name: c.env.LEGAL_NAME || 'NukkadSale',
    address: c.env.LEGAL_ADDRESS || '',
    email: c.env.SUPPORT_EMAIL || '',
    phone: c.env.SUPPORT_PHONE || '',
  }
}

const Page = (p: { c: Context<AppEnv>; title: string; children: Child }) => (
  <Layout t={tr(p.c)} path={here(p.c)} title={`${p.title} – NukkadSale`}>
    <article class="legal">
      <h1>{p.title}</h1>
      <p class="muted">Last updated: {UPDATED}</p>
      {p.children}
    </article>
  </Layout>
)

const ContactLines = ({ c }: { c: Context<AppEnv> }) => {
  const b = biz(c)
  return (
    <ul>
      <li><b>NukkadSale</b>{b.name !== 'NukkadSale' ? ` – operated by ${b.name}` : ''}</li>
      {b.address && <li>{b.address}</li>}
      {b.email && <li>Email: <a href={`mailto:${b.email}`}>{b.email}</a></li>}
      {b.phone && <li>WhatsApp: <a href={waLink(b.phone, 'Hi, I have a question about NukkadSale')}>+{b.phone}</a></li>}
    </ul>
  )
}

legal.get('/privacy', (c) => {
  const b = biz(c)
  return c.html(
    <Page c={c} title="Privacy policy">
      <p>NukkadSale is a tool that helps sellers on WhatsApp take orders, collect payments and keep accounts. This policy explains what personal data NukkadSale handles, why, and your choices. It is operated by {b.name}.</p>

      <h2>Data we handle</h2>
      <p><b>Sellers:</b> name, shop name, mobile number, UPI IDs, payment-gateway keys (stored encrypted), a login PIN (stored only as a one-way hash), sales, orders, khata entries and settings.</p>
      <p><b>Buyers:</b> name, WhatsApp number, delivery address and pincode, what you ordered and paid, any payment screenshot you send, and the messages you send to the NukkadSale WhatsApp ordering number.</p>
      <p><b>Website visitors:</b> which of our pages you open, the buttons and links you tap, how long a page is open and how far you scroll, the site that sent you there, your device type (phone or computer) and approximate city from your network. This is anonymous – we use a random id kept in your browser, no cookies and no third-party analytics – it is only used to improve NukkadSale and is deleted after 180 days. If your browser sends “Do Not Track”, nothing is recorded.</p>
      <p><b>Technical:</b> a login cookie for sellers and admins, a language cookie, and details saved in your own browser to fill checkout faster next time (you can clear them anytime). We keep a one-way hash of the network address of website orders to stop one device from holding too much stock; we do not keep the address itself.</p>

      <h2>Why we use it</h2>
      <ul>
        <li>To take and deliver orders: the seller you buy from sees your name, number, address and order.</li>
        <li>To match payments: each order gets a unique amount so the seller can recognise your payment.</li>
        <li>To send order updates on WhatsApp (payment received, shipping updates).</li>
        <li>To prevent abuse (for example one device holding all the stock) and to keep accounts secure.</li>
        <li>To provide support and meet legal obligations.</li>
      </ul>
      <p>We do not sell personal data and do not use it for advertising.</p>

      <h2>Who it is shared with</h2>
      <ul>
        <li><b>The seller</b> you order from.</li>
        <li><b>Service providers that run the service:</b> Cloudflare (hosting, database and photo storage), Meta (WhatsApp messages, when you use WhatsApp ordering), and Razorpay (when the seller uses automatic payments).</li>
        <li><b>Authorities</b>, only when the law requires it.</li>
      </ul>

      <h2>How long we keep it</h2>
      <p>Orders and khata entries are the seller's business records and are kept while the seller's account is active, so they can handle deliveries, refunds and taxes. Login sessions expire after 60 days (admin sessions after 30 days). You can ask us to delete or anonymise your data at any time (see below); we may keep what the law requires.</p>

      <h2>Your rights</h2>
      <p>Under India's Digital Personal Data Protection Act, 2023 you can ask to access, correct or erase your personal data, and you can raise a grievance. Use the <a href="/data-request">data request form</a> or contact us. We verify requests on WhatsApp before acting and reply within 30 days.</p>

      <h2>Security</h2>
      <p>All traffic uses HTTPS. Gateway keys are encrypted, PINs are hashed, payment screenshots are visible only to the seller of that order, and buyers are never shown stock counts or other buyers' details.</p>

      <h2>Children</h2>
      <p>NukkadSale is not meant for people under 18.</p>

      <h2>Changes</h2>
      <p>We will update this page when our practices change and show the new date at the top.</p>

      <h2>Contact and grievances</h2>
      <ContactLines c={c} />
    </Page>,
  )
})

legal.get('/terms', (c) => {
  const b = biz(c)
  return c.html(
    <Page c={c} title="Terms of use">
      <p>These terms apply to everyone who uses NukkadSale, operated by {b.name}. By creating a shop or placing an order you agree to them.</p>

      <h2>What NukkadSale is</h2>
      <p>NukkadSale is software for sellers: it creates sale pages and order links, holds stock while a buyer pays, helps match payments and keeps a khata. <b>NukkadSale is not the seller and is not a party to any sale.</b> Payments go directly from the buyer to the seller – to the seller's UPI ID or through the seller's own payment-gateway account. NukkadSale does not hold or transfer anyone's money.</p>

      <h2>Sellers</h2>
      <ul>
        <li>You are responsible for your products, listings, prices, delivery, returns, refunds, invoices and taxes.</li>
        <li>You may only sell lawful products and must describe them honestly.</li>
        <li>Confirm a payment only after the money is in your account. A buyer's screenshot is not proof of payment.</li>
        <li>Keep your PIN and gateway keys private. You can change or remove gateway keys at any time.</li>
        <li>If a buyer pays after an item is sold out, you must refund them.</li>
        <li>Plan fees, if any apply to your shop, are shown in your account under the NukkadSale plan page. Payment gateways charge their own fees under their own terms.</li>
      </ul>

      <h2>Buyers</h2>
      <ul>
        <li>Your purchase is a contract with the seller. Questions about products, delivery and refunds go to the seller (every order page has a link to message them).</li>
        <li>Pay only the amount shown for your order. Stock is held for you for a limited time while you pay.</li>
      </ul>

      <h2>Fair use and suspension</h2>
      <p>We may pause or close accounts that break these terms, sell unlawful items, misuse the service, or do not pay applicable plan fees. Pausing a shop stops new orders; it does not affect payments already made to the seller.</p>

      <h2>Liability</h2>
      <p>We work to keep NukkadSale available and accurate, but it is provided as is. To the extent the law allows, {b.name} is not liable for losses arising from sales between sellers and buyers, from payment apps or gateways, or from service interruptions.</p>

      <h2>Changes and contact</h2>
      <p>We may update these terms and will show the new date at the top. Questions:</p>
      <ContactLines c={c} />
    </Page>,
  )
})

legal.get('/refunds', (c) =>
  c.html(
    <Page c={c} title="Refund & cancellation policy">
      <p>NukkadSale is the software sellers use to run their shop. <b>Buyers pay the seller directly</b> – to the seller's UPI ID or the seller's own Razorpay account – so NukkadSale never holds a buyer's money. That is why product refunds come from the seller, while refunds of NukkadSale's own plan fee come from us.</p>
      <h2>Buyers: orders and refunds</h2>
      <ul>
        <li><b>Refunds are given by the seller.</b> Use “Message seller” on your order page. The seller refunds to the UPI ID or card you paid from.</li>
        <li><b>Cancel before paying:</b> simply don't pay, or tap “Cancel” in the WhatsApp chat. The piece is held only for a few minutes and nothing is charged.</li>
        <li><b>Cancelled after paying:</b> ask the seller; once they cancel, they refund you in full. A cash-on-delivery advance is refunded the same way.</li>
        <li><b>Paid after the item sold out:</b> the order is marked “Refund due” for the seller, who must return your money.</li>
        <li><b>Paid twice or the wrong amount:</b> tell the seller – they see every payment in their UPI app and return anything extra.</li>
        <li><b>Part of an order can't be sent:</b> the seller refunds the part they can't send.</li>
        <li><b>Returns and exchanges</b> follow the seller's own policy – ask before you buy if it matters to you.</li>
        <li><b>Gateway payments</b> (Razorpay) are refunded by the seller through the gateway, usually to the original payment method within a few working days.</li>
        <li><b>Seller not replying?</b> Write to us (below) with your order number. We can't refund money we never received, but we will contact the seller, and a seller who doesn't settle refunds can have their shop paused.</li>
      </ul>
      <h2>If a shop is paused or closed</h2>
      <ul>
        <li>The shop stops taking new orders. Orders already placed stay open, so the seller can still confirm, send or refund them, and you can still see your order page.</li>
      </ul>
      <h2>Sellers: the NukkadSale plan fee</h2>
      <ul>
        <li>The Shuruaat plan is free. Paid plans are billed per month, as shown on your plan page – there is no commission on your sales.</li>
        <li>Upgrading takes off anything you already paid for that month.</li>
        <li>You can stop at any time by contacting us; no new invoices are created after that.</li>
        <li>Fees already paid for a month are not refunded, except when we charged you twice or by mistake – then we refund the extra in full.</li>
      </ul>
      <h2>Contact</h2>
      <ContactLines c={c} />
    </Page>,
  ),
)

legal.get('/contact', (c) =>
  c.html(
    <Page c={c} title="Contact us">
      <p>We usually reply within 2 working days.</p>
      <ContactLines c={c} />
      <p>About an order, delivery or refund? Please message the seller first – use the link on your order page.</p>
      <p>Privacy or data requests: use the <a href="/data-request">data request form</a>.</p>
    </Page>,
  ),
)

legal.get('/data-request', (c) =>
  c.html(
    <Page c={c} title="Data request">
      <p>Ask for a copy of your data, or for your data to be deleted. We will message you on WhatsApp to confirm it is really you, then complete the request within 30 days. Sellers' business records may be kept where the law requires.</p>
      <Flash msg={c.req.query('ok')} kind="ok" />
      <Flash msg={c.req.query('err')} />
      <form method="post" class="card stack">
        <div><label for="phone">Your WhatsApp number</label><PhoneInput id="phone" name="phone" /></div>
        <div class="stack">
          <label class="choice"><input type="radio" name="kind" value="delete" checked style="width:22px;min-height:22px;flex:none" /> <span>Delete my data</span></label>
          <label class="choice"><input type="radio" name="kind" value="copy" style="width:22px;min-height:22px;flex:none" /> <span>Send me a copy of my data</span></label>
        </div>
        <div><label for="note">Anything we should know (optional)</label><textarea id="note" name="note" maxlength={500} /></div>
        <button class="btn primary block" type="submit">Send request</button>
      </form>
    </Page>,
  ),
)

legal.post('/data-request', async (c) => {
  const f = await c.req.parseBody()
  const phone = normalizePhone(String(f.phone ?? ''))
  if (!phone) return c.redirect('/data-request?err=' + encodeURIComponent('Please enter a valid 10-digit WhatsApp number.'), 303)
  const kind = f.kind === 'copy' ? 'copy' : 'delete'
  await c.env.DB.prepare(`INSERT INTO data_requests (phone, kind, note, created_at) VALUES (?, ?, ?, ?)`)
    .bind(phone, kind, String(f.note ?? '').trim().slice(0, 500), Date.now()).run()
  return c.redirect('/data-request?ok=' + encodeURIComponent('Request received. We will message you on WhatsApp to confirm.'), 303)
})
