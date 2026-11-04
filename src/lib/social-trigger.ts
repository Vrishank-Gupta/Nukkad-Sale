import type { Bindings } from '../env'

/*
 * Daily social posting at 19:00 IST. GitHub's own schedule can start hours late (it once ran the 18:35 job
 * at 1:28 am), but a job started through the API ("workflow_dispatch") begins within seconds. So the site's
 * cron – every 2 minutes, reliable – starts .github/workflows/social.yml at 19:00 IST, once a day.
 * The job posts that day's items from docs/social/schedule.json and skips anything already posted, so a
 * second start never posts twice.
 */
const REPO = 'Vrishank-Gupta/Nukkad-Sale'
const AT_MIN = 19 * 60 // 19:00 IST
const WINDOW_MIN = 30   // try until 19:30 if GitHub doesn't answer

export async function socialTrigger(env: Bindings, now = Date.now()) {
  if (!env.GH_DISPATCH_TOKEN) return
  const ist = new Date(now + 330 * 60_000)
  const mins = ist.getUTCHours() * 60 + ist.getUTCMinutes()
  if (mins < AT_MIN || mins >= AT_MIN + WINDOW_MIN) return
  const day = ist.toISOString().slice(0, 10)
  // Claim the day first, so two cron runs at once can't both start the job.
  const claim = await env.DB.prepare(`INSERT INTO platform_settings (key, value) VALUES ('social_dispatched', ?1)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value WHERE platform_settings.value <> ?1`).bind(day).run()
  if (!claim.meta.changes) return
  const res = await fetch(`https://api.github.com/repos/${REPO}/actions/workflows/social.yml/dispatches`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.GH_DISPATCH_TOKEN}`, Accept: 'application/vnd.github+json', 'User-Agent': 'nukkadsale-cron', 'Content-Type': 'application/json' },
    body: JSON.stringify({ ref: 'main', inputs: { date: day } }),
  })
  if (res.status !== 204) {
    // Let the next cron run (2 min later) try again.
    await env.DB.prepare(`UPDATE platform_settings SET value = '' WHERE key = 'social_dispatched' AND value = ?`).bind(day).run()
    console.error('social dispatch failed', res.status, (await res.text()).slice(0, 200))
  }
}
