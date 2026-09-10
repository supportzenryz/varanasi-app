/* The site on a phone.
 *
 * Written after a screenshot from the client's own phone showed the public menu
 * with no way to close it and the admin navigation reduced to about ninety
 * pixels of sideways-scrolling window — "access", "Settin", and no way to
 * reach anything. Both were invisible on a laptop, which is the whole problem
 * with checking responsive layout by dragging a browser window: the desktop
 * breakpoint is the one you look at.
 *
 * Four widths, because they are the ones that exist: 320 (an SE in portrait,
 * still the narrowest thing worth supporting), 360 (most Android), 390 (recent
 * iPhone), 430 (a Pro Max). Every public page and every admin screen is
 * checked for a page that scrolls sideways — which is the single most common
 * responsive fault and the easiest to measure honestly: anything wider than
 * the viewport is something a thumb will find.
 *
 *   npm run test:mobile          (needs the server running)
 *   BASE_URL=https://… npm run test:mobile
 */
import { launchBrowser } from './browser.mjs';

const BASE = (process.env.BASE_URL || 'http://localhost:3000').replace(/\/+$/, '');
const WIDTHS = [320, 360, 390, 430];
const results = [];
const t = (n, ok, d = '') => { results.push({ n, ok, d }); console.log(`${ok ? '  PASS' : '  FAIL'}  ${n}${d ? ' — ' + d : ''}`); };

/* The admin checks sign in, so put the owner back on a known password first —
   the CLI recovery tool has been exercised against this database. */
{
  const { DatabaseSync } = await import('node:sqlite');
  const bcrypt = (await import('bcryptjs')).default;
  const db = new DatabaseSync('data/varanasi.db');
  db.prepare('update users set password_hash = ?, must_change_password = 0 where email = ?')
    .run(bcrypt.hashSync('ChangeMe!2026', 10), 'owner@varanasi.uk');
  db.close();
}

const browser = await launchBrowser();

/** Anything wider than the viewport is a horizontal scroll a phone user feels. */
const overflow = (p) => p.evaluate(() => {
  const de = document.documentElement;
  const over = [...document.querySelectorAll('body *')]
    .filter((el) => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && (r.right > de.clientWidth + 1 || r.left < -1);
    })
    .slice(0, 4)
    .map((el) => `${el.tagName.toLowerCase()}.${(el.className || '').toString().split(' ')[0]} @${Math.round(el.getBoundingClientRect().right)}`);
  return { pageWidth: de.scrollWidth, viewport: de.clientWidth, worst: over };
});

console.log('\n── The public site menu, on a phone ──');
for (const width of WIDTHS) {
  const ctx = await browser.newContext({ viewport: { width, height: 720 }, isMobile: true, hasTouch: true });
  const p = await ctx.newPage();
  await p.goto(`${BASE}/birmingham`, { waitUntil: 'networkidle' });

  const o1 = await overflow(p);
  t(`${width}px: the page itself does not scroll sideways`, o1.pageWidth <= o1.viewport + 1,
    `${o1.pageWidth} vs ${o1.viewport}${o1.worst.length ? ' · ' + o1.worst.join(', ') : ''}`);

  const toggle = p.locator('header button[aria-controls="site-menu"]');
  t(`${width}px: there is one menu button`, await toggle.count() === 1);
  t(`${width}px: it is big enough to hit`, await toggle.evaluate((el) => {
    const r = el.getBoundingClientRect();
    return r.width >= 40 && r.height >= 40;
  }), await toggle.evaluate((el) => { const r = el.getBoundingClientRect(); return `${Math.round(r.width)}×${Math.round(r.height)}`; }));

  await toggle.click();
  await p.waitForTimeout(250);
  t(`${width}px: it opens`, await p.locator('#site-menu').isVisible());
  t(`${width}px: and says it is open`, await toggle.getAttribute('aria-expanded') === 'true');
  t(`${width}px: the button now reads "Close menu"`, (await toggle.getAttribute('aria-label')) === 'Close menu');

  // The panel must fit the screen and scroll inside itself, not push the page.
  const panel = await p.locator('#site-menu').evaluate((el) => {
    const r = el.getBoundingClientRect();
    return { top: Math.round(r.top), height: Math.round(r.height), scrollable: el.scrollHeight > el.clientHeight + 1 };
  });
  t(`${width}px: the panel fits the screen`, panel.height <= 720 && panel.top >= -1,
    `top ${panel.top}, ${panel.height}px tall${panel.scrollable ? ', scrolls inside' : ''}`);

  // Every link is reachable: scroll the panel to the end and check the last one.
  const lastVisible = await p.evaluate(() => {
    const panel = document.getElementById('site-menu');
    panel.scrollTop = panel.scrollHeight;
    const links = [...panel.querySelectorAll('a')];
    const last = links[links.length - 1].getBoundingClientRect();
    return last.bottom <= window.innerHeight + 1 && last.top >= 0;
  });
  t(`${width}px: the last item can be reached`, lastVisible);

  t(`${width}px: the page behind cannot scroll`,
    await p.evaluate(() => getComputedStyle(document.body).overflow === 'hidden'));

  // Escape.
  await p.keyboard.press('Escape');
  await p.waitForTimeout(200);
  t(`${width}px: Escape closes it`, await p.locator('#site-menu').count() === 0);
  t(`${width}px: and the page scrolls again`,
    await p.evaluate(() => getComputedStyle(document.body).overflow !== 'hidden'));

  /* Tapping away from the panel — but only where there IS an away. Thirteen
     sections fill a phone screen top to bottom, so on a phone the panel is the
     whole viewport and the scrim behind it is unreachable by definition. The
     first version of this check asserted it anyway and reported a failure that
     described the layout working as intended. */
  await toggle.click();
  await p.waitForTimeout(200);
  const gapBelow = await p.locator('#site-menu').evaluate(
    (el) => window.innerHeight - el.getBoundingClientRect().bottom);
  if (gapBelow > 20) {
    await p.mouse.click(width / 2, 720 - gapBelow / 2);
    await p.waitForTimeout(200);
    t(`${width}px: tapping away from it closes it`, await p.locator('#site-menu').count() === 0);
  } else {
    t(`${width}px: the panel fills the screen, so there is no "away" to tap`, true,
      `${Math.round(gapBelow)}px below it`);
    await toggle.click();
    await p.waitForTimeout(200);
  }

  // The button itself, from a known-closed state.
  t(`${width}px: closed before the last check`, await p.locator('#site-menu').count() === 0);
  await toggle.click();
  await p.waitForTimeout(200);
  await toggle.click();
  await p.waitForTimeout(250);
  t(`${width}px: pressing the button again closes it`, await p.locator('#site-menu').count() === 0);

  await ctx.close();
}

console.log('\n── The admin, on a phone ──');
for (const width of WIDTHS) {
  const ctx = await browser.newContext({ viewport: { width, height: 720 }, isMobile: true, hasTouch: true });
  const p = await ctx.newPage();
  await p.goto(`${BASE}/admin/login`, { waitUntil: 'networkidle' });
  await p.fill('input[name="email"]', 'owner@varanasi.uk');
  await p.fill('input[name="password"]', 'ChangeMe!2026');
  await p.click('button[type="submit"]');
  await p.waitForURL((u) => !u.pathname.startsWith('/admin/login'), { timeout: 20000 }).catch(() => {});
  t(`${width}px: signed in`, !p.url().includes('/admin/login'), new URL(p.url()).pathname);

  const o = await overflow(p);
  t(`${width}px: the admin does not scroll sideways`, o.pageWidth <= o.viewport + 1,
    `${o.pageWidth} vs ${o.viewport}${o.worst.length ? ' · ' + o.worst.join(', ') : ''}`);

  const btn = p.locator('button[aria-controls="admin-menu"]');
  t(`${width}px: there is a Menu button`, await btn.count() === 1);
  t(`${width}px: fully on screen`, await btn.evaluate((el) => {
    const r = el.getBoundingClientRect();
    return r.right <= document.documentElement.clientWidth + 1 && r.left >= 0;
  }));

  await btn.click();
  await p.waitForTimeout(250);
  const drawer = p.locator('#admin-menu');
  t(`${width}px: the drawer opens`, await drawer.isVisible());

  const sections = await drawer.locator('nav a').count();
  t(`${width}px: every section is listed`, sections >= 12, `${sections} links`);

  const allReachable = await p.evaluate(() => {
    const panel = document.getElementById('admin-menu');
    const links = [...panel.querySelectorAll('nav a')];
    // Scroll to each in turn; every one has to land inside the viewport.
    return links.every((a) => {
      a.scrollIntoView({ block: 'center' });
      const r = a.getBoundingClientRect();
      return r.left >= 0 && r.right <= window.innerWidth + 1 && r.height >= 36;
    });
  });
  t(`${width}px: each one is reachable and tall enough to tap`, allReachable);

  const signOut = p.locator('#admin-menu button:has-text("Sign out")');
  t(`${width}px: Sign out is in the drawer`, await signOut.count() === 1);
  t(`${width}px: and on screen once scrolled to`, await signOut.evaluate((el) => {
    el.scrollIntoView({ block: 'center' });
    const r = el.getBoundingClientRect();
    return r.left >= 0 && r.right <= window.innerWidth + 1;
  }));

  await p.keyboard.press('Escape');
  await p.waitForTimeout(200);
  t(`${width}px: Escape closes the drawer`, await p.locator('#admin-menu').count() === 0);

  // The current section is named, now that the rail is hidden.
  t(`${width}px: the bar says which screen you are on`,
    (await p.locator('.lg\\:hidden.sticky p').first().innerText()).trim().length > 0,
    (await p.locator('.lg\\:hidden.sticky p').first().innerText()).trim());

  await ctx.close();
}

console.log('\n── Every public page, at the narrowest phone ──');
{
  const ctx = await browser.newContext({ viewport: { width: 320, height: 720 }, isMobile: true, hasTouch: true });
  const p = await ctx.newPage();
  for (const path of ['/', '/birmingham', '/birmingham/menu', '/birmingham/drinks', '/birmingham/book-online',
    '/birmingham/gift-vouchers', '/birmingham/private-dining-experiences', '/birmingham/gallery',
    '/birmingham/contact', '/birmingham/catering', '/birmingham/corporate-dining-events',
    '/birmingham/book-a-private-room', '/birmingham/franchise-opportunities',
    '/birmingham/privacy', '/birmingham/terms', '/leicester', '/leicester/menu']) {
    await p.goto(`${BASE}${path}`, { waitUntil: 'networkidle' });
    const o = await overflow(p);
    t(`320px ${path}`, o.pageWidth <= o.viewport + 1,
      o.pageWidth <= o.viewport + 1 ? '' : `${o.pageWidth}px wide · ${o.worst.join(', ')}`);
  }
  await ctx.close();
}

console.log('\n── Every admin screen, at the narrowest phone ──');
{
  const ctx = await browser.newContext({ viewport: { width: 320, height: 720 }, isMobile: true, hasTouch: true });
  const p = await ctx.newPage();
  await p.goto(`${BASE}/admin/login`, { waitUntil: 'networkidle' });
  await p.fill('input[name="email"]', 'owner@varanasi.uk');
  await p.fill('input[name="password"]', 'ChangeMe!2026');
  await p.click('button[type="submit"]');
  await p.waitForURL((u) => !u.pathname.startsWith('/admin/login'), { timeout: 20000 }).catch(() => {});

  /* The admin is where the wide content lives — tables of bookings, the
     activity log, the enquiry list. A table that is wider than the screen is
     fine as long as IT scrolls; the page must not. */
  for (const path of ['/admin', '/admin/menu', '/admin/rooms', '/admin/bookings', '/admin/dates',
    '/admin/vouchers', '/admin/enquiries', '/admin/marketing', '/admin/gallery', '/admin/staff', '/admin/settings',
    '/admin/logs', '/admin/erasure', '/admin/backups', '/admin/password']) {
    await p.goto(`${BASE}${path}`, { waitUntil: 'networkidle' });
    const o = await overflow(p);
    t(`320px ${path}`, o.pageWidth <= o.viewport + 1,
      o.pageWidth <= o.viewport + 1 ? '' : `${o.pageWidth}px wide · ${o.worst.join(', ')}`);
  }
  await ctx.close();
}

console.log('\n' + '─'.repeat(60));
const failed = results.filter((r) => !r.ok);
console.log(`${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) { console.log('\nFAILURES:'); failed.forEach((f) => console.log(`  ${f.n} — ${f.d}`)); }
await browser.close();
process.exit(failed.length ? 1 : 0);
