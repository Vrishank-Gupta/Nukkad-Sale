import type { Bindings } from '../env'

/*
 * Notification emails to the owner through Cloudflare's send_email binding (free). The binding
 * only delivers to its verified destination address, set in wrangler.jsonc. Without the binding,
 * or if sending fails, nothing breaks – the request is still waiting in Admin → Requests.
 */
export async function notifyOwner(env: Bindings, subject: string, text: string, replyTo?: string) {
  if (!env.LEAD_MAIL) return false
  try {
    await env.LEAD_MAIL.send({
      from: { name: 'NukkadSale', email: env.MAIL_FROM || 'noreply@nukkadsale.in' },
      to: env.LEAD_MAIL_TO || 'hello@vrishankgupta.in',
      subject,
      text,
      ...(replyTo ? { replyTo } : {}),
    })
    return true
  } catch (e) {
    console.error('notify email failed', e)
    return false
  }
}
