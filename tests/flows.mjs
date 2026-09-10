/* The two journeys the client asked about, walked on a phone.
 *
 * A guest buying a gift voucher and somebody who has forgotten the admin
 * password. Both are new, both involve money or access, and both had only ever
 * been exercised by unit tests against the library functions — which prove the
 * rules are right and say nothing about whether the buttons are reachable with
 * a thumb.
 *
 * So this drives a real browser at 390px through the whole of each: the
 * purchase form, the payment page, the voucher the guest is emailed, scanning
 * its code at the till, a partial redemption and the ledger line it leaves;
 * then the reset email, the link in it, a weak password being refused, a good
 * one accepted, signing in with it, and the link refusing to work twice.
 *
 *   npm run test:flows           (needs the server running)
 */
import { launchBrowser } from './browser.mjs';
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import bcrypt from 'bcryptjs';

const BASE = (process.env.BASE_URL || 'http://localhost:3000').replace(/\/+$/, '');
const results = [];
const t = (n, ok, d = '') => { results.push({ n, ok, d }); console.log(`${ok ? '  PASS' : '  FAIL'}  ${n}${d ? ' — ' + d : ''}`); };

const q = (sql, ...p) => { const db = new DatabaseSync('data/varanasi.db'); try { return db.prepare(sql).all(...p); } finally { db.close(); } };
const run = (sql, ...p) => { const db = new DatabaseSync('data/varanasi.db'); try { return db.prepare(sql).run(...p); } finally { db.close(); } };

/* A real inbox for the reset link. Mail goes to data/outbox as readable text
   when no provider is configured, which is how the restaurant can see what
   went out — and how this check reads the link a person would click. */
const outboxLink = () => {
  const dir = 'data/outbox';
  const files = fs.readdirSync(dir).filter(f => f.includes('set-a-new-password')).sort();
  if (!files.length) return null;
  const body = fs.readFileSync(`${dir}/${files.at(-1)}`, 'utf8');
  return /\/admin\/reset\?token=([0-9a-f]{64})/.exec(body)?.[1] ?? null;
};

const OWNER = 'owner@varanasi.uk';
run('update users set password_hash = ?, must_change_password = 0 where email = ?',
    bcrypt.hashSync('ChangeMe!2026', 10), OWNER);
run('delete from rate_limits');
run('delete from password_resets');

const browser = await launchBrowser();
const phone = { viewport: { width: 390, height: 800 }, isMobile: true, hasTouch: true };

console.log('\n── A guest buys a gift voucher, on a phone ──');
{
  const ctx = await browser.newContext(phone);
  const p = await ctx.newPage();
  const buyer = `flow.buyer.${Date.now()}@zenryz-test.com`;
  await p.goto(`${BASE}/birmingham/gift-vouchers`, { waitUntil: 'networkidle' });

  const before = q('select count(*) as n from vouchers')[0].n;
  await p.locator('input[name="fromName"]').fill('Anita Rao');
  await p.locator('input[name="fromEmail"]').fill(buyer);
  await p.locator('input[name="toName"]').fill('Dev Rao');
  await p.locator('input[name="toEmail"]').fill(`flow.recip.${Date.now()}@zenryz-test.com`);
  /* The amount is a set of radios named `value`, the £50 one pre-selected and
     visually hidden behind a styled label — so check it rather than clicking
     the sr-only input. */
  await p.locator('input[name="value"][value="5000"]').check({ force: true });
  // The consent boxes are visually hidden behind styled labels, so force it.
  for (const box of await p.locator('form input[type="checkbox"][required]').all()) {
    await box.check({ force: true });
  }
  await p.locator('form button').last().click();
  /* Not `gift-vouchers` in this pattern — that is the page the form is on, so
     it matches instantly and waits for nothing. Only the destinations a
     successful submit can reach. */
  await p.waitForURL(/checkout-simulator|\/confirmed/, { timeout: 20000 }).catch(() => {});

  t('the form reaches a payment page', /checkout-simulator|checkout\.stripe/.test(p.url()),
    new URL(p.url()).pathname + new URL(p.url()).search.slice(0, 40));

  if (p.url().includes('checkout-simulator')) {
    await p.locator('a, button').filter({ hasText: /^Pay £/i }).first().click();
    await p.waitForURL(/confirmed/, { timeout: 20000 }).catch(() => {});
    t('paying lands on the confirmation', /confirmed/.test(p.url()));

    const after = q('select count(*) as n from vouchers')[0].n;
    t('a voucher row exists', after === before + 1, `${before} -> ${after}`);
    const v = q("select code, status, balance_pence from vouchers order by id desc limit 1")[0];
    t('it is active and carries its full balance', v.status === 'active' && v.balance_pence > 0,
      `${v.code} ${v.status} ${v.balance_pence}p`);

    // The voucher page the guest is emailed.
    await p.goto(`${BASE}/birmingham/gift-vouchers/${v.code}`, { waitUntil: 'networkidle' });
    t('the voucher page opens on a phone', await p.locator('svg[aria-label^="Gift voucher"]').count() === 1);
    t('  · and shows the code', (await p.locator('body').innerText()).includes(v.code));
    const wide = await p.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
    t('  · with no sideways scroll', !wide);
    const qr = await p.locator('svg[aria-label^="Gift voucher"]').boundingBox();
    t('  · the code is big enough for a camera', qr.width >= 120, `${Math.round(qr.width)}px`);

    // Staff redeem it at the till, from the QR's own URL.
    const p2 = await (await browser.newContext(phone)).newPage();
    await p2.goto(`${BASE}/admin/login`, { waitUntil: 'networkidle' });
    await p2.fill('input[name="email"]', OWNER);
    await p2.fill('input[name="password"]', 'ChangeMe!2026');
    await p2.click('button[type="submit"]');
    await p2.waitForURL(u => !u.pathname.startsWith('/admin/login'), { timeout: 20000 }).catch(() => {});
    await p2.goto(`${BASE}/admin/vouchers?code=${v.code}`, { waitUntil: 'networkidle' });
    t('scanning it opens the till screen with the voucher looked up',
      (await p2.locator('body').innerText()).includes(v.code));

    await p2.locator('#amount').fill('20');
    await p2.locator('form:has(input[name="amount"]) button').last().click();
    /* Wait for the action's own redirect rather than for the network to go
       quiet: a server action posts and then redirects, and `networkidle` can
       resolve in the gap between the two. */
    await p2.waitForURL(/saved=|problem=/, { timeout: 20000 }).catch(() => {});
    const said = await p2.locator('body').innerText();
    const left = q('select balance_pence from vouchers where code = ?', v.code)[0].balance_pence;
    t('taking £20 off leaves the rest', left === v.balance_pence - 2000,
      left === v.balance_pence - 2000 ? `${left}p left` : `${left}p left · ${said.slice(0, 160).replace(/\n+/g, ' | ')}`);
    t('  · and the screen says so', /redeemed/i.test(said));

    const ledger = q('select count(*) as n from voucher_redemptions where voucher_id = (select id from vouchers where code = ?)', v.code)[0].n;
    t('  · with one line in the ledger', ledger === 1);
    await p2.context().close();
  }
  await ctx.close();
}

console.log('\n── Somebody forgets the admin password, on a phone ──');
{
  const ctx = await browser.newContext(phone);
  const p = await ctx.newPage();
  await p.goto(`${BASE}/admin/login`, { waitUntil: 'networkidle' });
  t('the sign-in page offers a way out', await p.locator('a[href="/admin/forgot"]').count() === 1);
  const wide = await p.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
  t('  · and fits the screen', !wide);

  await p.locator('a[href="/admin/forgot"]').click();
  await p.waitForLoadState('networkidle');
  await p.fill('input[name="email"]', OWNER);
  await p.locator('form button').last().click();
  await p.getByText(/check your email/i).first().waitFor({ timeout: 15000 }).catch(() => {});
  t('it says to check the inbox', /check your email/i.test(await p.locator('body').innerText()));

  const token = outboxLink();
  t('a link was emailed', Boolean(token), token ? `${token.slice(0, 12)}…` : 'nothing in the outbox');

  await p.goto(`${BASE}/admin/reset?token=${token}`, { waitUntil: 'networkidle' });
  t('the link opens a form for the right account',
    (await p.locator('body').innerText()).includes(OWNER));

  // A weak one is refused.
  await p.fill('#password', 'ChangeMe!2026');
  await p.fill('#confirm', 'ChangeMe!2026');
  await p.locator('form button').last().click();
  /* Wait for the refusal itself, not for "an alert" — the page can already
     have one, and `useActionState` re-renders without navigating, so there is
     no load event to wait on either. */
  await p.getByText(/starting password/i).first().waitFor({ timeout: 15000 }).catch(() => {});
  t('the starting password is refused', /starting password/i.test(await p.locator('body').innerText()));

  // A good one goes through.
  const fresh = 'copper-Lantern-tuesday7';
  await p.fill('#password', fresh);
  await p.fill('#confirm', fresh);
  await p.locator('form button').last().click();
  await p.waitForURL(/admin\/login/, { timeout: 20000 }).catch(() => {});
  t('a good password lands back at sign-in', /admin\/login/.test(p.url()), new URL(p.url()).search);
  t('  · with a message saying it worked', /new password is saved/i.test(await p.locator('body').innerText()));

  await p.fill('input[name="email"]', OWNER);
  await p.fill('input[name="password"]', fresh);
  await p.locator('form button').last().click();
  await p.waitForURL(u => !u.pathname.startsWith('/admin/login'), { timeout: 20000 }).catch(() => {});
  t('the new password signs you in', !p.url().includes('/admin/login'), new URL(p.url()).pathname);

  // The link is spent.
  await p.goto(`${BASE}/admin/reset?token=${token}`, { waitUntil: 'networkidle' });
  t('the link cannot be used again', /already been used/i.test(await p.locator('body').innerText()));

  // Changing it again from inside, and landing somewhere.
  await p.goto(`${BASE}/admin/password`, { waitUntil: 'networkidle' });
  await p.fill('#current', fresh);
  await p.fill('#next', 'Quiet7Rivers-Marmalade');
  await p.fill('#confirm', 'Quiet7Rivers-Marmalade');
  await p.locator('form button').last().click();
  await p.waitForURL(/\/admin(\?|$)/, { timeout: 20000 }).catch(() => {});
  t('changing it from the admin lands on the overview', /\/admin(\?|$)/.test(p.url()), new URL(p.url()).pathname);
  t('  · and says what happened', /new password is saved/i.test(await p.locator('body').innerText()));
  await ctx.close();
}

// leave the owner where the other suites expect it
run('update users set password_hash = ?, must_change_password = 0 where email = ?',
    bcrypt.hashSync('ChangeMe!2026', 10), OWNER);
run("delete from vouchers where purchaser_email like 'flow.%@zenryz-test.com'");
run('delete from rate_limits');

console.log('\n' + '─'.repeat(60));
const failed = results.filter(r => !r.ok);
console.log(`${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) { console.log('\nFAILURES:'); failed.forEach(f => console.log(`  ${f.n} — ${f.d}`)); }
await browser.close();
process.exit(failed.length ? 1 : 0);
