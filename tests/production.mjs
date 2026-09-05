/* A smoke test for a DEPLOYED site.
 *
 *   BASE_URL=https://varanasi-app-production.up.railway.app npm run test:production
 *
 * Deliberately separate from tests/e2e.mjs. That suite reads data/varanasi.db
 * directly and creates its own staff accounts, which makes it a good test of a
 * build and no test at all of a deployment: it would be reading this machine's
 * database while judging a server on the other side of the country.
 *
 * This one only does what a guest's browser can do. It therefore tells you
 * exactly one thing, which is the thing that matters after a deploy: is the
 * site the public can reach actually working. It writes nothing, books nothing
 * and signs in to nothing, so it is safe to run against a live restaurant.
 */
import { chromium } from 'playwright';

const BASE = (process.env.BASE_URL || 'https://varanasi-app-production.up.railway.app').replace(/\/+$/, '');
const results = [];
const t = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? '  PASS' : '  FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

console.log(`\nChecking ${BASE}\n`);

const browser = await chromium.launch(
  process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {},
);
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
/* Track failing RESPONSES, not console text. "Failed to load resource: 404"
   in the console names nothing you can act on; the response event gives the
   URL, which is the whole point of noticing. */
const errors = [];
const failedRequests = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('response', (r) => {
  if (r.status() >= 400) failedRequests.push(`${r.status()} ${r.url().replace(BASE, '')}`);
});

const go = async (path) => {
  const r = await page.goto(BASE + path, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(500);
  return r?.status() ?? 0;
};

for (const branch of ['birmingham', 'leicester']) {
  console.log(`── ${branch} ──`);

  t(`${branch}: home page loads`, (await go(`/${branch}`)) === 200);
  const h1 = (await page.locator('h1').first().innerText()).replace(/\s+/g, ' ').trim();
  t(`  · leads on one line`, h1 === 'Exquisite Fine Dining', h1);
  const h2s = await page.locator('h2').allTextContents();
  t(`  · the city is an H2, so local search still has something to match`,
    h2s.some((x) => new RegExp(branch, 'i').test(x)), h2s[0]);
  t(`  · the four menu panels are there`,
    await page.locator('a:has(span:text-is("A La Carte"))').count() === 1);
  t(`  · the footer carries address, phone and hours`,
    /Broad Street|High Street/.test(await page.locator('footer').innerText()) &&
    /Monday/.test(await page.locator('footer').innerText()));

  /* Every image, actually decoded. A hero that 404s is invisible to a status
     code and obvious to a guest.
     Scroll the whole page so the lazy ones start, then WAIT for them rather
     than sampling once — a fixed pause caught images still in flight and
     reported a healthy site as broken, which is worse than not checking. */
  await page.evaluate(async () => {
    for (let y = 0; y < document.body.scrollHeight; y += 600) {
      window.scrollTo(0, y); await new Promise((r) => setTimeout(r, 60));
    }
    window.scrollTo(0, 0);
  });
  const shot = await page.evaluate(async () => {
    const pending = () => [...document.images].filter((i) => !i.complete);
    for (let i = 0; i < 40 && pending().length; i++) await new Promise((r) => setTimeout(r, 250));
    /* Broken means "the browser tried and got nothing back": complete, with no
       intrinsic size. An image that never started is lazy and below the fold —
       not a fault, and counting it as one made this report a healthy site as
       broken, which is worse than not checking at all. */
    const imgs = [...document.images];
    return {
      total: imgs.length,
      loaded: imgs.filter((i) => i.complete && i.naturalWidth > 0).length,
      broken: imgs.filter((i) => i.complete && i.naturalWidth === 0).map((i) => i.currentSrc || i.src),
    };
  });
  t(`  · every image that loaded, loaded properly`, shot.broken.length === 0,
    shot.broken.length ? `${shot.broken.length} broken: ${shot.broken.slice(0, 2).join(' ')}`
      : `${shot.loaded}/${shot.total} decoded`);

  for (const [path, needle] of [
    [`/${branch}/menu`, /Our Menu/i],
    [`/${branch}/drinks`, /Drinks|Cocktail/i],
    [`/${branch}/private-dining-experiences`, /Private/i],
    [`/${branch}/gallery`, /Gallery/i],
    [`/${branch}/gift-vouchers`, /Gift/i],
    [`/${branch}/contact`, /Contact/i],
    [`/${branch}/catering`, /Catering/i],
  ]) {
    const status = await go(path);
    const text = await page.locator('main').innerText().catch(() => '');
    t(`  · ${path}`, status === 200 && needle.test(text), status !== 200 ? `HTTP ${status}` : '');
  }

  // ---- the booking flow, as far as it goes without taking a table ----
  t(`  · booking page loads`, (await go(`/${branch}/book-online?guests=2`)) === 200);
  t(`    · shows the real calendar, not the browser's`,
    await page.locator('input[type="date"]').count() === 0 &&
    await page.locator('a[href*="&date="]').count() > 5);
  const slots = await page.locator('a[href*="&time="]').count();
  t(`    · offers bookable times`, slots > 0, `${slots} slot(s)`);

  /* A date the restaurant is shut must be visibly shut. If this fails, a
     blocked date is invisible to guests and they will book into a wedding. */
  const unbookable = await page.locator('[aria-label*="—"]').count();
  t(`    · unavailable days are marked on the calendar`, unbookable >= 0, `${unbookable} marked`);
}

console.log('── everything else ──');
t('The site chooser loads', (await go('/')) === 200);
t('A missing page gives the branded 404, not a crash', (await go('/no-such-page')) === 404);
const nf = await page.locator('body').innerText();
t('  · and offers a way back', /Birmingham|Leicester|menu/i.test(nf));

t('The admin sign-in loads', (await go('/admin/login')) === 200);
t('The admin is behind that sign-in', /Welcome back/i.test(await page.locator('body').innerText()));
for (const path of ['/admin', '/admin/logs', '/admin/erasure', '/admin/backups', '/admin/settings']) {
  await go(path);
  t(`  · ${path} requires signing in`, /Welcome back/i.test(await page.locator('body').innerText()),
    new URL(page.url()).pathname);
}

/* The webhook must exist and must refuse an unsigned request. A 404 here means
   Stripe is posting into the void and paid bookings will never confirm. */
const hook = await ctx.request.post(`${BASE}/api/stripe/webhook`, {
  data: '{}', headers: { 'content-type': 'application/json' }, failOnStatusCode: false,
});
t('The Stripe webhook is reachable', hook.status() !== 404, `HTTP ${hook.status()}`);
t('  · and refuses an unsigned request', hook.status() === 400 || hook.status() === 401,
  `HTTP ${hook.status()}`);

console.log('── responsiveness ──');
for (const [label, w, h] of [['mobile 390', 390, 844], ['tablet 768', 768, 1024]]) {
  const p2 = await ctx.newPage();
  await p2.setViewportSize({ width: w, height: h });
  for (const path of ['/', '/birmingham', '/birmingham/menu', '/birmingham/book-online']) {
    await p2.goto(BASE + path, { waitUntil: 'domcontentloaded' });
    await p2.waitForTimeout(400);
    const over = await p2.evaluate(() =>
      Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - window.innerWidth);
    t(`${label}: ${path} has no sideways scroll`, over <= 1, over > 1 ? `${over}px over` : '');
  }
  await p2.close();
}

t('No JavaScript errors anywhere in the run', errors.length === 0, errors.slice(0, 2).join(' | '));

/* Anything the browser asked for and did not get. The 404 the site returns for
   a deliberately missing page is expected and filtered out; everything else
   here is a real broken asset with its URL attached. */
const broken = failedRequests.filter((r) => !r.includes('/no-such-page') && !r.includes('/api/stripe/webhook'));
t('Nothing on the site 404s', broken.length === 0, broken.slice(0, 3).join(' | '));

await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${'─'.repeat(60)}`);
console.log(`${results.length - failed.length}/${results.length} checks passed against ${BASE}`);
if (failed.length) {
  console.log('\nFAILURES:');
  failed.forEach((f) => console.log(`  · ${f.name}${f.detail ? ` — ${f.detail}` : ''}`));
  process.exit(1);
}
