import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';

/* Point this at a deployment to smoke-test it:
 *   BASE_URL=https://your-app.up.railway.app npm run test:e2e
 * The browser-driven checks all work remotely. The few that read data/varanasi.db
 * directly are asserting against the *local* file, so treat a remote run as a
 * check of the pages and journeys rather than of the database. */
const BASE = (process.env.BASE_URL || 'http://localhost:3000').replace(/\/+$/, '');
const results = [];
const t = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? '  PASS' : '  FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

/** Read straight from SQLite, so we are checking the database and not the page
 *  that just rendered it. */
const q = (sql) =>
  JSON.parse(execFileSync('python3', ['-c', `
import sqlite3, json
db = sqlite3.connect('data/varanasi.db')
db.row_factory = sqlite3.Row
print(json.dumps([dict(r) for r in db.execute(${JSON.stringify(sql)})]))
`]).toString());

const stamp = Date.now();

// Reset the owner to the seeded credentials so the run does not depend on
// whether a previous run already changed the password.
execFileSync('python3', ['-c', `
import sqlite3, bcrypt
db = sqlite3.connect('data/varanasi.db')
db.execute('update users set password_hash=?, must_change_password=1 where email=?',
           (bcrypt.hashpw(b'ChangeMe!2026', bcrypt.gensalt(10)).decode(), 'owner@varanasi.uk'))
db.commit()
`]);

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
const errors = [];
/* Some checks below deliberately request URLs that must 404 — the backup
   path-traversal probes. Those are the test working, not the site failing. */
let expect404s = false;
page.on('console', m => {
  if (m.type() !== 'error') return;
  if (expect404s && /404|Failed to load resource/i.test(m.text())) return;
  errors.push(m.text());
});
page.on('pageerror', e => errors.push(e.message));

console.log('\n── 1. Public site: navigation and layout ──');

await page.goto(`${BASE}/birmingham`, { waitUntil: 'networkidle' });

const navLinks = await page.locator('header nav[aria-label="Main"] a').allTextContents();
t('Catering is linked in the main header nav', navLinks.some(l => /catering/i.test(l)),
  `nav = ${navLinks.join(', ')}`);

const cateringHref = await page.locator('header nav a', { hasText: /^Catering$/ }).first().getAttribute('href');
t('Catering link points at the rebuilt route, not /exact', cateringHref === '/birmingham/catering', cateringHref);

const footerText = (await page.locator('footer').innerText()).replace(/\s+/g, ' ').trim();
t('Footer is one line of small print', footerText.length < 80, JSON.stringify(footerText));
t('Footer carries the copyright', /© \d{4} Varanasi Restaurant/.test(footerText));
t('Only one footer on the page', await page.locator('footer').count() === 1,
  `${await page.locator('footer').count()} found`);

const bodyHtml = await page.content();
t('Today/hours strip removed from the top of the homepage',
  await page.locator('main span', { hasText: /^Today$/ }).count() === 0);
t('Venue stat tiles removed', !/Unique Venue/i.test(bodyHtml));

const rootFont = await page.evaluate(() => getComputedStyle(document.documentElement).fontSize);
t('Base type scale lifted above the 16px default', parseFloat(rootFont) >= 17.5, rootFont);

// Scroll the whole page first so lazy images actually fire, then require
// every one to have decoded. Checking only `complete && naturalWidth === 0`
// passes vacuously for images that never started loading.
await page.evaluate(async () => {
  for (let y = 0; y < document.body.scrollHeight; y += window.innerHeight / 2) {
    window.scrollTo(0, y);
    await new Promise(r => setTimeout(r, 150));
  }
  // Deliberately stay at the bottom: scrolling back to the top deprioritises
  // the images that were just requested and they never finish.
});
await page.waitForLoadState('networkidle');
// Poll until every image settles rather than guessing a delay — Next's image
// optimizer is cold on first request in dev and a fixed wait made this flaky.
await page.waitForFunction(
  () => [...document.querySelectorAll('img')].every(i => i.complete),
  null, { timeout: 30000 },
).catch(() => {});
const imgState = await page.evaluate(() =>
  [...document.querySelectorAll('img')].map(i => ({
    src: (i.currentSrc || i.src).slice(-60), ok: i.complete && i.naturalWidth > 0,
  })));
const badImgs = imgState.filter(i => !i.ok);
t(`All ${imgState.length} homepage images decoded`, badImgs.length === 0,
  badImgs.map(i => i.src).join(', '));

// Every private-dining card must carry a real photograph, since that section
// is the page's main visual argument.
const roomImgs = await page.evaluate(() =>
  [...document.querySelectorAll('section li img')].map(i => i.complete && i.naturalWidth > 0));
t(`All ${roomImgs.length} private-dining cards show a photograph`,
  roomImgs.length > 0 && roomImgs.every(Boolean),
  `${roomImgs.filter(Boolean).length}/${roomImgs.length} loaded`);

console.log('\n── 2. Front-end form writes to the database ──');

const testEmail = `e2e.${stamp}@zenryz-test.com`;
const testPhone = '0121 900 ' + String(stamp).slice(-4);

await page.goto(`${BASE}/birmingham/catering`, { waitUntil: 'networkidle' });
t('Catering page reachable and rendered', await page.locator('h1, h2').first().isVisible());

await page.fill('input[name="name"]', `E2E Catering ${stamp}`);
await page.fill('input[name="email"]', testEmail);
await page.fill('input[name="phone"]', testPhone);
await page.fill('textarea[name="message"]', 'Automated end-to-end check. Please ignore.');
await page.check('input[name="terms"]');
await page.click('form button:has-text("Send enquiry")');
await page.waitForURL(/\?(sent|error)=/, { timeout: 15000 }).catch(() => {});

t('Sender is returned to the page they filled in, not the contact page',
  new URL(page.url()).pathname === '/birmingham/catering', page.url());
t('Form shows a confirmation', /reached us|thank you|received/i.test(await page.locator('main').innerText()));

let row = q(`select * from enquiries where email = '${testEmail}'`);
t('Enquiry row created in the database', row.length === 1, `${row.length} row(s)`);
if (row.length === 1) {
  const e = row[0];
  t('  · type stored as catering', e.type === 'catering', e.type);
  t('  · branch scoped to Birmingham', q(`select city from branches where id=${e.branch_id}`)[0]?.city === 'Birmingham');
  t('  · phone stored as typed', e.phone === testPhone, e.phone);
  t('  · status starts as new', e.status === 'new', e.status);
  t('  · GDPR terms acceptance timestamped', Number(e.terms_accepted_at) > 0, String(e.terms_accepted_at));
  t('  · marketing consent defaults to off', e.marketing_consent === 0, String(e.marketing_consent));
}

console.log('\n── 3. Consent is enforced by the server, not just the browser ──');

await page.goto(`${BASE}/birmingham/contact`, { waitUntil: 'networkidle' });
const refusedEmail = `e2e.refused.${stamp}@zenryz-test.com`;
await page.fill('input[name="name"]', 'E2E No Consent');
await page.fill('input[name="email"]', refusedEmail);
await page.fill('textarea[name="message"]', 'Should be refused.');
// Strip the HTML guards so the request actually reaches the server unticked.
await page.evaluate(() => document.querySelectorAll('[required]').forEach(el => el.removeAttribute('required')));
await page.click('form button:has-text("Send enquiry")');
await page.waitForURL(/\?(sent|error)=/, { timeout: 15000 }).catch(() => {});
t('Enquiry without consent is refused server-side',
  q(`select id from enquiries where email = '${refusedEmail}'`).length === 0);

console.log('\n── 3b. Junk contact details are refused by the server ──');

/* The browser's own validation is trivially bypassed, so each of these strips
   the HTML guards first and submits anyway — what is being tested is that the
   server refuses, not that the input had a pattern attribute. */
for (const [label, phone] of [
  ['a single digit', '1'],
  ['one digit repeated', '1111111111'],
  ['letters', 'not a phone'],
  ['a number too short to dial', '0770'],
]) {
  const email = `e2e.junk.${label.replace(/\W+/g, '')}.${stamp}@zenryz-test.com`;
  await page.goto(`${BASE}/birmingham/catering`, { waitUntil: 'networkidle' });
  await page.fill('input[name="name"]', 'E2E Junk Phone');
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="phone"]', phone);
  await page.fill('textarea[name="message"]', 'Automated check. Please ignore.');
  await page.check('input[name="terms"]');
  await page.evaluate(() => document.querySelectorAll('[required],[pattern]').forEach(el => {
    el.removeAttribute('required'); el.removeAttribute('pattern');
  }));
  await page.click('form button:has-text("Send enquiry")');
  await page.waitForURL(/\?(sent|error)=/, { timeout: 15000 }).catch(() => {});
  t(`phone rejected: ${label}`, q(`select id from enquiries where email = '${email}'`).length === 0);
}

// The counterpart: a real number in a messy shape must still get through.
const okEmail = `e2e.goodphone.${stamp}@zenryz-test.com`;
await page.goto(`${BASE}/birmingham/catering`, { waitUntil: 'networkidle' });
await page.fill('input[name="name"]', 'E2E Good Phone');
await page.fill('input[name="email"]', okEmail);
await page.fill('input[name="phone"]', '(07700) 900-123');
await page.fill('textarea[name="message"]', 'Automated check. Please ignore.');
await page.check('input[name="terms"]');
await page.click('form button:has-text("Send enquiry")');
await page.waitForURL(/\?(sent|error)=/, { timeout: 15000 }).catch(() => {});
const good = q(`select phone from enquiries where email = '${okEmail}'`);
t('a real number typed with brackets and dashes is accepted', good.length === 1);
t('  · and stored the way the guest typed it, for staff to recognise',
  good[0]?.phone === '(07700) 900-123', good[0]?.phone);

// A mistyped provider is named rather than silently accepted.
const typoEmail = `e2e.typo.${stamp}@gmial.com`;
await page.goto(`${BASE}/birmingham/catering`, { waitUntil: 'networkidle' });
await page.fill('input[name="name"]', 'E2E Typo');
await page.fill('input[name="email"]', typoEmail);
await page.fill('textarea[name="message"]', 'Automated check. Please ignore.');
await page.check('input[name="terms"]');
await page.evaluate(() => document.querySelectorAll('[required]').forEach(el => el.removeAttribute('required')));
await page.click('form button:has-text("Send enquiry")');
await page.waitForURL(/\?(sent|error)=/, { timeout: 15000 }).catch(() => {});
t('gmial.com is refused, not silently accepted',
  q(`select id from enquiries where email = '${typoEmail}'`).length === 0);
t('  · and the guest is told what to fix',
  /did you mean/i.test(await page.locator('main').innerText()));

console.log('\n── 3c. Both sides are emailed, on every outcome ──');

/* The outbox is where mail lands when no provider key is set, so it is also
   the cheapest way to assert who was written to. Each check counts only files
   created after a marker time, so an earlier run cannot make it pass. */
const outbox = 'data/outbox';
const mailSince = (t0) => {
  if (!fs.existsSync(outbox)) return [];
  return fs.readdirSync(outbox)
    .filter(f => f.endsWith('.txt'))
    .map(f => `${outbox}/${f}`)
    .filter(p => fs.statSync(p).mtimeMs >= t0)
    .map(p => fs.readFileSync(p, 'utf8'));
};
const restaurantInbox = q(`select value from settings where key='booking_rules'`)
  .map(r => { try { return JSON.parse(r.value)?.notifications?.to ?? []; } catch { return []; } })
  .flat();

/* Booking is a three-step flow driven by the URL: party size and date, then
   the slot picker, then details. Step 2 is loaded and a real slot clicked
   rather than a time guessed — availability is re-checked on submit, so a
   guessed time would fail for the wrong reason. */
const bookOnce = async (email) => {
  const when = new Date(Date.now() + 6 * 864e5).toISOString().slice(0, 10);
  await page.goto(`${BASE}/birmingham/book-online?guests=2&date=${when}`, { waitUntil: 'networkidle' });
  const slot = page.locator('a[href*="time="]').first();
  if (!(await slot.count())) return null;
  await slot.click();
  await page.waitForLoadState('networkidle');
  await page.fill('input[name="name"]', 'E2E Booking Guest');
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="phone"]', '07700 900123');
  /* Tick every required box rather than naming them: the deposit step asks for
     three separate confirmations and a missed one is silent — the browser just
     blocks submit and the page says "please confirm", which reads like a
     server refusal but is not one. */
  for (const box of await page.locator('form input[type="checkbox"][required]').all()) {
    await box.check();
  }
  await page.click('form button.btn-gold');
  await page.waitForURL(/checkout-simulator|confirmed|book-online/, { timeout: 20000 }).catch(() => {});
  const rows = q(`select reference, cancel_token from bookings where email = '${email}'`);
  return rows[0] ?? null;
};

// ---- a failed payment ----
const failEmail = `e2e.payfail.${stamp}@zenryz-test.com`;
const failBk = await bookOnce(failEmail);
t('Booking created through the real three-step form', Boolean(failBk));

if (failBk) {
  const t0 = Date.now();
  /* domcontentloaded, not networkidle: this page sends two emails while it
     renders and the hero photograph is being optimised on a cold build, so
     waiting for the network to fall quiet times out on a first run. What
     matters here is that the render happened and the mail was written. */
  /* First: without the token, nothing may happen. A plain GET on this URL used
     to release the table, so a link preview or an email scanner could cancel a
     guest's booking. */
  await page.goto(`${BASE}/birmingham/book-online/unconfirmed?ref=${failBk.reference}`,
    { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1200);
  t('A hold is NOT released without the booking token',
    mailSince(t0).length === 0, `${mailSince(t0).length} message(s)`);

  // Then with it, which is the URL Stripe actually sends the guest back to.
  await page.goto(
    `${BASE}/birmingham/book-online/unconfirmed?ref=${failBk.reference}&t=${failBk.cancel_token}`,
    { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);
  const mail = mailSince(t0);
  t('payment failed → the guest is told', mail.some(m => m.includes(failEmail)));
  t('payment failed → the restaurant is told too, so the booking can be rescued',
    mail.some(m => restaurantInbox.some(a => m.includes(a)) && /payment failed/i.test(m)),
    `${mail.length} message(s) to ${restaurantInbox.join(',')}`);
}

// ---- a guest cancelling ----
// A fresh booking: cancelByToken only accepts a live one, so the booking used
// above is deliberately not reused.
const cxlEmail = `e2e.cancel.${stamp}@zenryz-test.com`;
const cxlBk = await bookOnce(cxlEmail);
t('Second booking created, still live, for the cancellation path', Boolean(cxlBk));

if (cxlBk) {
  const t0 = Date.now();
  await page.goto(`${BASE}/birmingham/booking/${cxlBk.reference}?t=${cxlBk.cancel_token}`,
    { waitUntil: 'networkidle' });
  /* Cancelling is deliberately two steps now: one tap used to forfeit a paid
     deposit with no confirmation and no undo. */
  const step1 = page.locator('a:has-text("Cancel this booking")').first();
  t('Manage page offers the guest a way to cancel', await step1.count() > 0);
  if (await step1.count()) {
    await step1.click();
    await page.waitForLoadState('networkidle');
    const warned = await page.locator('main').innerText();
    t('  · and warns before doing it, naming the deposit', /cannot be undone/i.test(warned));
    const step2 = page.locator('form button:has-text("Yes, cancel it")').first();
    t('  · with an explicit confirm', await step2.count() > 0);
    await step2.click();
    await page.waitForTimeout(2200);
    const mail = mailSince(t0);
    t('guest cancels → the restaurant is told',
      mail.some(m => restaurantInbox.some(a => m.includes(a)) && /cancel/i.test(m)));
    t('guest cancels → the guest gets it in writing, so they need not ring to check',
      mail.some(m => m.includes(cxlEmail) && /cancel/i.test(m)),
      `${mail.length} message(s)`);
    t('  · and the booking is actually cancelled',
      q(`select status from bookings where reference='${cxlBk.reference}'`)[0]?.status === 'cancelled',
      q(`select status from bookings where reference='${cxlBk.reference}'`)[0]?.status);
  }
}

console.log('\n── 4. Admin: sign in ──');

await page.goto(`${BASE}/admin/login`, { waitUntil: 'networkidle' });
t('Login page shows the Varanasi logo',
  await page.locator('img[alt="Varanasi"]').first().isVisible());

let signedIn = false;
for (const pw of ['ChangeMe!2026']) {
  await page.goto(`${BASE}/admin/login`, { waitUntil: 'networkidle' });
  await page.fill('input[name="email"]', 'owner@varanasi.uk');
  await page.fill('input[name="password"]', pw);
  await page.click('button[type="submit"]');
  await page.waitForURL(u => !u.pathname.startsWith('/admin/login'), { timeout: 10000 }).catch(() => {});
  if (!page.url().includes('/admin/login')) { signedIn = true; break; }
}
t('Owner can sign in', signedIn, page.url());

t('First sign-in forces a password change', page.url().includes('/admin/password'), page.url());
if (page.url().includes('/admin/password')) {
  await page.fill('input[name="current"]', 'ChangeMe!2026');
  await page.fill('input[name="next"]', 'RealPass!2026x');
  await page.fill('input[name="confirm"]', 'RealPass!2026x');
  await page.locator('form button').last().click();
  await page.waitForURL(u => !u.pathname.includes('/admin/password'), { timeout: 10000 }).catch(() => {});
}

await page.goto(`${BASE}/admin`, { waitUntil: 'networkidle' });
t('Admin sidebar shows the logo', await page.locator('aside img[alt="Varanasi"]').isVisible());

console.log('\n── 5. Admin enquiries: search, filters, export ──');

await page.goto(`${BASE}/admin/enquiries?status=all`, { waitUntil: 'networkidle' });
t('New enquiry appears in the inbox', (await page.locator('main').innerText()).includes(`E2E Catering ${stamp}`));

// search by email
await page.goto(`${BASE}/admin/enquiries?status=all&q=${encodeURIComponent(testEmail)}`, { waitUntil: 'networkidle' });
let cards = await page.locator('article').count();
t('Search by email returns exactly the one match', cards === 1, `${cards} card(s)`);

// search by phone, punctuation stripped
await page.goto(`${BASE}/admin/enquiries?status=all&q=${encodeURIComponent(testPhone.replace(/\s/g, ''))}`, { waitUntil: 'networkidle' });
cards = await page.locator('article').count();
t('Search by phone ignores spacing', cards === 1, `${cards} card(s) for "${testPhone.replace(/\s/g, '')}"`);

// date range
await page.goto(`${BASE}/admin/enquiries?status=all&range=today`, { waitUntil: 'networkidle' });
t('"Today" range includes an enquiry just made',
  (await page.locator('main').innerText()).includes(`E2E Catering ${stamp}`));

await page.goto(`${BASE}/admin/enquiries?status=all&range=today&q=${encodeURIComponent(testEmail)}`, { waitUntil: 'networkidle' });
t('Date range and search combine', await page.locator('article').count() === 1);

// location filter
await page.goto(`${BASE}/admin/enquiries?status=all&branch=leicester&q=${encodeURIComponent(testEmail)}`, { waitUntil: 'networkidle' });
t('Location filter excludes the other branch', await page.locator('article').count() === 0);

// export
const res = await ctx.request.get(`${BASE}/admin/enquiries/export?status=all&q=${encodeURIComponent(testEmail)}`);
const csv = await res.text();
const disp = res.headers()['content-disposition'] ?? '';
t('CSV export responds 200', res.status() === 200, String(res.status()));
t('CSV is served as a download', /attachment/.test(disp), disp);
t('CSV filename is dated and named', /varanasi-enquiries.*\d{4}-\d{2}-\d{2}\.csv/.test(disp), disp);
t('CSV content type is text/csv', /text\/csv/.test(res.headers()['content-type'] ?? ''));
t('CSV has a UTF-8 BOM so Excel reads £ correctly', csv.charCodeAt(0) === 0xFEFF);
t('CSV header row present', csv.includes('"Reference","Received","Status","Type","Branch"'));
t('CSV respects the active filter', csv.split(/\r?\n/).filter(l => l.trim()).length === 2,
  `${csv.split(/\r?\n/).filter(l => l.trim()).length} line(s) incl. header`);
t('CSV contains the enquiry', csv.includes(testEmail));

console.log('\n── 6. Admin → website: a category and dish added in the admin appear publicly ──');

const catName = `E2E Section ${stamp}`;
const dishName = `E2E Dish ${stamp}`;

await page.goto(`${BASE}/admin/menu?branch=birmingham&kind=food`, { waitUntil: 'networkidle' });
await page.locator('summary', { hasText: /Add new section/i }).first().click();
await page.fill('input[name="name"]', catName);
await page.locator('button', { hasText: /^Add section$/ }).first().click();
await page.locator('h2', { hasText: catName }).first()
  .waitFor({ state: 'attached', timeout: 15000 }).catch(() => {});

const cat = q(`select * from menu_categories where name = '${catName}'`);
t('Category created in the database', cat.length === 1, `${cat.length} row(s)`);
if (cat.length === 1) {
  t('  · slug generated', cat[0].slug === `e2e-section-${stamp}`, cat[0].slug);
  t('  · kind carried through from the tab', cat[0].kind === 'food', cat[0].kind);
  t('  · sorted after the existing sections', cat[0].sort > 0, String(cat[0].sort));
  t('  · audit log written', q(`select id from audit_log where action='menu.category.create' and entity_id='${cat[0].id}'`).length === 1);
}

// add a dish to it, with a price, then check the public menu
await page.goto(`${BASE}/admin/menu?branch=birmingham&kind=food`, { waitUntil: 'networkidle' });
const addTo = page.locator('summary', { hasText: new RegExp(`Add to ${catName}`) }).first();
t('The new section offers an "Add to" form', await addTo.count() > 0);
if (await addTo.count() > 0) {
  await addTo.click();
  const form = page.locator(`form:has(input[name="categoryId"][value="${cat[0].id}"])`);
  await form.locator('input[name="name"]').fill(dishName);
  await form.locator('input[name="price"]').fill('23.50');
  await form.locator('input[name="description"]').fill('Added by the end-to-end check.');
  await form.locator('button').click();
  // Wait for the dish to actually appear in the re-rendered list before
  // asserting on the database — the server action commits after the click
  // returns, and querying straight away raced it.
  await page.locator('summary', { hasText: dishName }).first()
    .waitFor({ state: 'attached', timeout: 15000 }).catch(() => {});

  const dish = q(`select * from menu_items where name = '${dishName}'`);
  t('Dish created in the database', dish.length === 1);
  if (dish.length === 1) {
    t('  · price parsed to pence', dish[0].price_pence === 2350, String(dish[0].price_pence));
    t('  · attached to the new category', dish[0].category_id === cat[0].id);
  }

  await page.goto(`${BASE}/birmingham/menu`, { waitUntil: 'networkidle' });

  /* Sections arrive closed, so the index is what's visible first. That is the
     behaviour being asserted here: the section name shows without any
     interaction, and the dishes only after the reader opens it. */
  const indexText = await page.locator('main').innerText();
  t('New section appears on the public menu', indexText.includes(catName));
  t('Dishes stay hidden until the section is opened', !indexText.includes(dishName));

  const section = page.locator('details.menu-section', { hasText: catName }).first();
  await section.locator('summary').click();
  await page.waitForFunction(
    (n) => document.querySelector('main')?.innerText.includes(n),
    dishName, { timeout: 5000 },
  );
  const openText = await page.locator('main').innerText();
  t('New dish appears once the section is opened', openText.includes(dishName));
  t('Its price appears on the public menu', openText.includes('£23.50'));

  const leicester = await (await ctx.newPage()).goto(`${BASE}/leicester/menu`).then(async r => {
    const p = r.frame().page(); const txt = await p.locator('main').innerText(); await p.close(); return txt;
  });
  t('It does NOT leak into the other branch', !leicester.includes(dishName));
}

console.log('\n── 5b. What a guest sees when something goes wrong ──');

{
  // ---- the 404 ----
  expect404s = true;
  const res = await page.goto(`${BASE}/birmingham/no-such-page`, { waitUntil: 'networkidle' });
  const body = await page.locator('body').innerText();
  t('A wrong address returns 404', res.status() === 404, String(res.status()));
  t('  · and is the restaurant, not Next.js\'s white default page',
    !/This page could not be found/i.test(body));
  t('  · offering both restaurants and a phone number',
    /Birmingham/.test(body) && /Leicester/.test(body) && /\d{4}\s?\d{3}\s?\d{4}/.test(body));

  // ---- a rejected form keeps the guest's work ----
  await page.goto(`${BASE}/birmingham/catering`, { waitUntil: 'networkidle' });
  await page.fill('input[name="name"]', 'Lady Ashcombe');
  await page.fill('input[name="email"]', 'guest@gmial.com');   // a typo the site catches
  await page.fill('input[name="phone"]', '07700 900123');
  await page.fill('textarea[name="message"]', 'Fifty for a private dinner in October.');
  await page.check('input[name="terms"]');
  await page.click('form button:has-text("Send enquiry")');
  await page.waitForURL(/\?(sent|error)=/, { timeout: 15000 }).catch(() => {});

  const kept = await page.evaluate(() => ({
    name: document.querySelector('input[name="name"]')?.value ?? '',
    phone: document.querySelector('input[name="phone"]')?.value ?? '',
    message: document.querySelector('textarea[name="message"]')?.value ?? '',
  }));
  t('A rejected form gives the guest their answers back', kept.name === 'Lady Ashcombe', kept.name);
  t('  · including the message they composed', /private dinner/.test(kept.message));
  t('  · and shows the real reason',
    /did you mean/i.test(await page.locator('[role=alert]').first().innerText().catch(() => '')));

  // ---- the error text cannot be written by whoever sends the link ----
  await page.goto(
    `${BASE}/birmingham/contact?error=${encodeURIComponent('Your card was declined. Call 0800 555 1234.')}`,
    { waitUntil: 'networkidle' });
  const banner = await page.locator('[role=alert]').first().innerText().catch(() => '');
  t('A crafted link cannot put its own words in the error banner',
    !/0800 555 1234/.test(banner), banner.slice(0, 50));

  // ---- on a phone, feedback is on screen ----
  const phone = await ctx.newPage();
  await phone.setViewportSize({ width: 375, height: 667 });
  await phone.goto(`${BASE}/birmingham/catering`, { waitUntil: 'networkidle' });
  await phone.fill('input[name="name"]', 'E2E Phone Guest');
  await phone.fill('input[name="email"]', `e2e.phone.${stamp}@zenryz-test.com`);
  await phone.fill('textarea[name="message"]', 'Checking the banner is visible.');
  await phone.check('input[name="terms"]');
  await phone.click('form button:has-text("Send enquiry")');
  await phone.waitForURL(/\?(sent|error)=/, { timeout: 15000 }).catch(() => {});
  await phone.waitForTimeout(1800);
  const where = await phone.evaluate(() => {
    const el = document.querySelector('[role=status],[role=alert]');
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { top: Math.round(r.top), onScreen: r.top >= -30 && r.top < window.innerHeight };
  });
  t('On a phone the confirmation is on screen, not ~800px below the fold',
    where?.onScreen === true, JSON.stringify(where));
  await phone.close();

  // ---- the chosen time reads as chosen ----
  const when5b = new Date(Date.now() + 8 * 864e5).toISOString().slice(0, 10);
  await page.goto(`${BASE}/birmingham/book-online?guests=2&date=${when5b}`, { waitUntil: 'networkidle' });
  const slotLink = page.locator('a[href*="time="]').first();
  if (await slotLink.count()) {
    await slotLink.click();
    /* Wait for the thing the click is supposed to reveal. networkidle resolves
       mid-navigation here, which shows a half-rendered page and made a working
       change look like a regression. */
    await page.waitForSelector('#your-details', { timeout: 15000 }).catch(() => {});
    const look = await page.evaluate(() => {
      const on = document.querySelector('a[aria-current="true"]');
      if (!on) return null;
      const c = getComputedStyle(on);
      return { bg: c.backgroundColor, border: c.borderTopColor };
    });
    // gold fill, not ink-on-ink which made the chosen slot vanish into the panel
    t('Choosing a time advances to the details step', await page.locator('#your-details').count() > 0);
    t('  · and the chosen slot is gold, not sunk into the ink panel',
      Boolean(look) && look.bg !== 'rgb(15, 15, 15)' && look.border !== 'rgb(15, 15, 15)',
      JSON.stringify(look));
  }
}

console.log('\n── 6a. Money and authority ──');

/* Each of these was a real hole found in audit, and each is the sort that
   regresses quietly because nothing visible breaks when it comes back. */
{
  // ---- a revoked account stops working immediately ----
  const ctx2 = await browser.newContext();
  const p2 = await ctx2.newPage();
  execFileSync('python3', ['-c', `
import sqlite3, bcrypt
db = sqlite3.connect('data/varanasi.db')
db.execute("update users set password_hash=?, must_change_password=0, is_active=1 where email='leicester@varanasi.uk'",
           (bcrypt.hashpw(b'ChangeMe!2026', bcrypt.gensalt(10)).decode(),))
db.commit()`]);
  await p2.goto(`${BASE}/admin/login`, { waitUntil: 'networkidle' });
  await p2.fill('input[name="email"]', 'leicester@varanasi.uk');
  await p2.fill('input[name="password"]', 'ChangeMe!2026');
  await p2.click('button[type="submit"]');
  await p2.waitForURL(u => !u.pathname.startsWith('/admin/login'), { timeout: 15000 }).catch(() => {});
  await p2.goto(`${BASE}/admin/vouchers`, { waitUntil: 'domcontentloaded' });
  t('A signed-in manager can reach the vouchers screen', p2.url().includes('/admin/vouchers'));

  // deactivate them while that session is still open
  execFileSync('python3', ['-c', `
import sqlite3
db = sqlite3.connect('data/varanasi.db')
db.execute("update users set is_active=0 where email='leicester@varanasi.uk'")
db.commit()`]);
  await p2.goto(`${BASE}/admin/vouchers`, { waitUntil: 'domcontentloaded' });
  t('Deactivating an account ends its session at once, not in 7 days',
    p2.url().includes('/admin/login'), new URL(p2.url()).pathname);

  // and a password change does the same, which is what makes "reset" a remedy
  execFileSync('python3', ['-c', `
import sqlite3, bcrypt
db = sqlite3.connect('data/varanasi.db')
db.execute("update users set is_active=1, password_hash=? where email='leicester@varanasi.uk'",
           (bcrypt.hashpw(b'Something-Else!2026', bcrypt.gensalt(10)).decode(),))
db.commit()`]);
  await p2.goto(`${BASE}/admin/vouchers`, { waitUntil: 'domcontentloaded' });
  t('Changing the password ends existing sessions too',
    p2.url().includes('/admin/login'), new URL(p2.url()).pathname);
  await ctx2.close();
  execFileSync('python3', ['-c', `
import sqlite3, bcrypt
db = sqlite3.connect('data/varanasi.db')
db.execute("update users set password_hash=?, must_change_password=1, is_active=1, role='manager' where email='leicester@varanasi.uk'",
           (bcrypt.hashpw(b'ChangeMe!2026', bcrypt.gensalt(10)).decode(),))
db.commit()`]);

  // ---- a resubmitted enquiry is one enquiry ----
  const dupeEmail = `e2e.dupe.${stamp}@zenryz-test.com`;
  for (let i = 0; i < 2; i++) {
    await page.goto(`${BASE}/birmingham/contact`, { waitUntil: 'networkidle' });
    await page.fill('input[name="name"]', 'E2E Duplicate');
    await page.fill('input[name="email"]', dupeEmail);
    await page.fill('textarea[name="message"]', 'Sent twice on purpose.');
    await page.check('input[name="terms"]');
    await page.click('form button:has-text("Send enquiry")');
    await page.waitForURL(/\?(sent|error)=/, { timeout: 15000 }).catch(() => {});
  }
  t('The same enquiry sent twice is stored once',
    q(`select id from enquiries where email = '${dupeEmail}'`).length === 1,
    `${q(`select id from enquiries where email = '${dupeEmail}'`).length} row(s)`);

  // ---- money is parsed, not guessed, and a redemption cannot be replayed ----
  await page.goto(`${BASE}/admin/vouchers`, { waitUntil: 'networkidle' });
  execFileSync('python3', ['-c', `
import sqlite3, time
db = sqlite3.connect('data/varanasi.db')
now = int(time.time())
db.execute("delete from vouchers where code='VG-E2ET-ESTE-ST01'")
db.execute('''insert into vouchers (code,value_pence,balance_pence,status,purchaser_name,purchaser_email,
recipient_name,recipient_email,origin,issued_at,expires_at,created_at)
values ('VG-E2ET-ESTE-ST01',5000,5000,'active','E2E Buyer','buyer@zenryz-test.com','E2E Recipient',
'recip@zenryz-test.com','purchase',?,?,?)''', (now, now + 31536000, now))
db.commit()`]);
  const v = q(`select code, balance_pence from vouchers where code='VG-E2ET-ESTE-ST01'`)[0];
  if (!v) {
    t('A live voucher exists to test redemption against', false, 'none found');
  } else {
    const redeem = async (amount, expected) => page.evaluate(async ([code, amt, bal]) => {
      const body = new URLSearchParams({ code, amount: amt, note: '', expectedBalance: String(bal) });
      const r = await fetch('/admin/vouchers', {
        method: 'POST', body,
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        redirect: 'follow',
      });
      return r.url;
    }, [v.code, amount, expected]);

    // A negative amount used to be read as positive and take the money again.
    await redeem('-10', v.balance_pence);
    const afterNeg = q(`select balance_pence from vouchers where code='${v.code}'`)[0].balance_pence;
    t('Redeeming "-10" takes nothing (it used to take £10)',
      afterNeg === v.balance_pence, `${v.balance_pence} -> ${afterNeg}`);

    // "14 / 18" style input must refuse rather than become £1,418.
    await redeem('14 / 18', v.balance_pence);
    const afterJunk = q(`select balance_pence from vouchers where code='${v.code}'`)[0].balance_pence;
    t('Redeeming "14 / 18" takes nothing', afterJunk === v.balance_pence,
      `${v.balance_pence} -> ${afterJunk}`);
  }
}

console.log('\n── 6b. Backups, and who may take the customer list ──');

/* Backups did not exist. The restaurant sells gift vouchers, which are money
   owed: a guest pays, holds a code, and this database is the only record the
   debt exists. These checks are here so that never silently stops working. */
{
  const dir = 'data/backups';
  const before = fs.existsSync(dir) ? fs.readdirSync(dir).filter(f => f.endsWith('.db')).length : 0;
  t('A backup exists', before > 0, `${before} file(s)`);

  if (before > 0) {
    const newest = fs.readdirSync(dir).filter(f => f.endsWith('.db'))
      .map(f => ({ f, m: fs.statSync(`${dir}/${f}`).mtimeMs }))
      .sort((a, z) => z.m - a.m)[0].f;

    // It has to open and hold the data, or it is a file rather than a backup.
    const rows = JSON.parse(execFileSync('python3', ['-c', `
import sqlite3, json
db = sqlite3.connect('${dir}/${newest}')
print(json.dumps({
  'tables': db.execute("select count(*) from sqlite_master where type='table'").fetchone()[0],
  'items':  db.execute('select count(*) from menu_items').fetchone()[0],
}))`]).toString());
    t('  · the newest backup opens and holds the schema', rows.tables >= 15, `${rows.tables} tables`);
    t('  · and the menu is in it', rows.items > 0, `${rows.items} items`);

    // The download takes a filename from the query string.
    await page.goto(`${BASE}/admin/backups`, { waitUntil: 'networkidle' });
    expect404s = true;
    for (const evil of ['../../.env.local', '..%2F..%2F.env.local', '../varanasi.db']) {
      const st = await page.evaluate(
        (x) => fetch(`/admin/backups/download?file=${encodeURIComponent(x)}`).then(r => r.status), evil);
      t(`  · path traversal refused: ${evil}`, st === 404, `HTTP ${st}`);
    }
    const okDl = await page.evaluate(
      (f) => fetch(`/admin/backups/download?file=${f}`).then(r => r.status), newest);
    t('  · the owner can download a real backup', okDl === 200, `HTTP ${okDl}`);
    expect404s = false;
  }
}

console.log('\n── 6b. Branch isolation: a Leicester manager cannot see Birmingham ──');

/* The explicit requirement: "Leicester manager won't be able to see the
   Birmingham and vice versa." Every screen used to work its own scoping out
   with `session.role !== "owner" && session.branchId != null`, which reads as
   "scope non-owners" and behaves as "scope non-owners who have a branch" — so
   an account with no branch fell through to unscoped and saw both. These
   checks sign in as real accounts rather than asserting on the source. */

const MGR_PW = 'MgrPass!2026x';
execFileSync('python3', ['-c', `
import sqlite3, bcrypt
db = sqlite3.connect('data/varanasi.db')
h = bcrypt.hashpw(b'${MGR_PW}', bcrypt.gensalt(10)).decode()
b = db.execute("select id from branches where slug='birmingham'").fetchone()[0]
l = db.execute("select id from branches where slug='leicester'").fetchone()[0]
for email, name, branch in [('e2e.leic@zenryz-test.com','E2E Leicester Manager', l),
                            ('e2e.brum@zenryz-test.com','E2E Birmingham Manager', b),
                            ('e2e.nobranch@zenryz-test.com','E2E Unassigned Manager', None)]:
    db.execute("delete from users where email=?", (email,))
    db.execute("insert into users (email,name,role,branch_id,password_hash,is_active,must_change_password)"
               " values (?,?,'manager',?,?,1,0)", (email, name, branch, h))
db.commit()
`]);

/** A signed-in browser context for one account, isolated from the owner's. */
const signInAs = async (email) => {
  const c = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const p = await c.newPage();
  await p.goto(`${BASE}/admin/login`, { waitUntil: 'networkidle' });
  await p.fill('input[name="email"]', email);
  await p.fill('input[name="password"]', MGR_PW);
  await p.click('button[type="submit"]');
  await p.waitForURL(u => !u.pathname.startsWith('/admin/login'), { timeout: 10000 }).catch(() => {});
  return { c, p };
};

/* A dish that exists at one branch and nowhere else. Picking "the first dish
   at Birmingham" is no test at all: both restaurants sell poppadoms, so the
   name appears on either menu and the check passes or fails for the wrong
   reason. These are planted with unique names instead. */
const brumDish = `E2E Brum Only ${stamp}`;
const leicDish = `E2E Leic Only ${stamp}`;
execFileSync('python3', ['-c', `
import sqlite3
db = sqlite3.connect('data/varanasi.db')
for slug, name in [('birmingham', '${brumDish}'), ('leicester', '${leicDish}')]:
    cat = db.execute("select mc.id from menu_categories mc join branches b on b.id=mc.branch_id"
                     " where b.slug=? and mc.kind='food' limit 1", (slug,)).fetchone()[0]
    db.execute("insert into menu_items (category_id,name,price_pence,sort,is_published)"
               " values (?,?,1234,999,1)", (cat, name))
db.commit()
`]);

const { c: leicCtx, p: leic } = await signInAs('e2e.leic@zenryz-test.com');
t('A branch manager can sign in', !leic.url().includes('/admin/login'), leic.url());

await leic.goto(`${BASE}/admin`, { waitUntil: 'networkidle' });
const leicHome = await leic.locator('main').innerText();
t('Manager overview says they are seeing their own branch',
  /seeing your own branch/i.test(leicHome));
t('Manager overview does not claim both branches', !/seeing both branches/i.test(leicHome));

// Menus
await leic.goto(`${BASE}/admin/menu?branch=birmingham&kind=food`, { waitUntil: 'networkidle' });
const leicMenu = await leic.locator('main').innerText();
t('Asking for Birmingham menus by URL lands on Leicester instead',
  /Leicester/i.test(leicMenu) && !/href="\/admin\/menu\?branch=birmingham/.test(await leic.content()));
t('No Birmingham dish is listed for a Leicester manager', !leicMenu.includes(brumDish), brumDish);

// Bookings
await leic.goto(`${BASE}/admin/bookings?branch=birmingham`, { waitUntil: 'networkidle' });
t('Asking for Birmingham bookings by URL lands on Leicester instead',
  /Leicester/i.test(await leic.locator('h1').innerText()), await leic.locator('h1').innerText());

// Enquiries — the Birmingham one this run created must not be visible.
await leic.goto(`${BASE}/admin/enquiries?status=all&q=${encodeURIComponent(testEmail)}`, { waitUntil: 'networkidle' });
t('A Birmingham enquiry is invisible to a Leicester manager',
  await leic.locator('article').count() === 0, `${await leic.locator('article').count()} card(s)`);

// Screens their role has no business on
for (const [path, label] of [['/admin/staff', 'Staff access'], ['/admin/settings', 'Settings'],
                             ['/admin/backups', 'Backups'], ['/admin/logs', 'Activity log']]) {
  await leic.goto(`${BASE}${path}`, { waitUntil: 'networkidle' });
  const landed = new URL(leic.url()).pathname;
  t(`${label} is closed to a manager`, landed === '/admin', landed);
}
const deniedText = await leic.locator('main').innerText();
t('And being turned away says so on screen, rather than looking like a dead link',
  /isn.t open to your account/i.test(deniedText));

// The sidebar should not offer what it cannot open.
const leicNav = await leic.locator('aside nav a').allTextContents();
t('Owner-only screens are absent from a manager sidebar',
  !leicNav.some(l => /staff access|settings|backups|activity log/i.test(l)), leicNav.join(', '));

// Vouchers: money tiles must be this branch's, and another branch's customer
// must not be named.
const brumVoucher = q(`select v.code, v.recipient_name from vouchers v
  join branches b on b.id = v.branch_id where b.slug = 'birmingham' limit 1`)[0];
if (brumVoucher) {
  await leic.goto(`${BASE}/admin/vouchers?code=${encodeURIComponent(brumVoucher.code)}`, { waitUntil: 'networkidle' });
  const vText = await leic.locator('main').innerText();
  t('A Birmingham voucher can still be checked at a Leicester till', vText.includes(brumVoucher.code));
  if (brumVoucher.recipient_name) {
    t('  · but the other branch\'s customer is not named',
      !vText.includes(brumVoucher.recipient_name), brumVoucher.recipient_name);
  }
}

await leicCtx.close();

// And the reverse direction, which is the half that usually goes untested.
const { c: brumCtx, p: brum } = await signInAs('e2e.brum@zenryz-test.com');
await brum.goto(`${BASE}/admin/menu?branch=leicester&kind=food`, { waitUntil: 'networkidle' });
const brumMenu = await brum.locator('main').innerText();
t('And a Birmingham manager cannot see Leicester either', /Birmingham/i.test(brumMenu));
t('  · no Leicester dish is listed', !brumMenu.includes(leicDish), leicDish);

await brumCtx.close();

// An account with no branch: nothing, and it says why.
const { c: noneCtx, p: none } = await signInAs('e2e.nobranch@zenryz-test.com');
await none.goto(`${BASE}/admin`, { waitUntil: 'networkidle' });
const noneText = await none.locator('main').innerText();
t('An unassigned manager is told their account has no restaurant',
  /no restaurant assigned/i.test(noneText));
t('  · and is not shown the group figures', !/seeing both branches/i.test(noneText));
await noneCtx.close();

console.log('\n── 6c. Sign-in is validated, throttled and recorded ──');

{
  const c = await browser.newContext();
  const p = await c.newPage();
  const before = q(`select count(*) as n from audit_log where action like 'login.%'`)[0].n;

  /* Read every role="alert" on the page rather than the first. Next.js adds
     its own empty one — the route announcer — and which of the two comes first
     depends on how the page was reached. */
  const alertText = async () => (await p.locator('[role="alert"]').allTextContents()).join(' ').trim();

  /* The email box is type="email", so the browser refuses to post "not-an-address"
     at all. That is the first line of two — the server also checks it, which is
     what tests/validate.mts covers, because reaching that path from a browser
     means defeating the browser's own validation first. */
  await p.goto(`${BASE}/admin/login`, { waitUntil: 'networkidle' });
  await p.fill('input[name="email"]', 'not-an-address');
  await p.fill('input[name="password"]', 'whatever');
  await p.click('button[type="submit"]');
  await p.waitForTimeout(800);
  t('The browser will not even post a malformed email address',
    await p.evaluate(() => !document.querySelector('input[name="email"]').checkValidity()));

  /* The same answer whether the address exists or not — a different one for a
     real account turns this form into a list of who works here. Checked before
     the lockout loop below, because that loop trips the per-address counter and
     the lock message would then answer for both. */
  for (const [address, label] of [['owner@varanasi.uk', 'a real account'],
                                  [`e2e.ghost.${stamp}@zenryz-test.com`, 'one that does not exist']]) {
    await p.goto(`${BASE}/admin/login`, { waitUntil: 'networkidle' });
    await p.fill('input[name="email"]', address);
    await p.fill('input[name="password"]', 'definitely-not-it');
    await p.click('button[type="submit"]');
    await p.waitForTimeout(900);
    t(`The refusal for ${label} gives nothing away`,
      /don.t match an active account/i.test(await alertText()), await alertText());
  }

  // Six wrong passwords against one address. The fifth trips the lock.
  const victim = `e2e.lockout.${stamp}@zenryz-test.com`;
  let lockMsg = '';
  for (let i = 0; i < 6; i++) {
    await p.goto(`${BASE}/admin/login`, { waitUntil: 'networkidle' });
    await p.fill('input[name="email"]', victim);
    await p.fill('input[name="password"]', `wrong-${i}`);
    await p.click('button[type="submit"]');
    await p.waitForTimeout(900);
    lockMsg = await alertText();
  }
  t('Repeated wrong passwords lock the address out', /too many attempts/i.test(lockMsg), lockMsg);
  t('  · and the lock says how long to wait', /minute/i.test(lockMsg), lockMsg);

  const after = q(`select count(*) as n from audit_log where action like 'login.%'`)[0].n;
  t('Failed sign-ins are written to the audit log', after > before, `${before} → ${after}`);
  t('  · including the lockout itself',
    q(`select id from audit_log where action='login.locked'`).length > 0);

  await c.close();
}

/* Server actions here end in a redirect carrying the message. waitForLoadState
   ('networkidle') resolves part-way through that navigation, so reading the
   page straight after it returns the render from *before* the redirect — the
   screen without the banner. Wait for the URL the action redirects to. */
const settled = async (p = page) => {
  await p.waitForURL(u => /[?&](saved|problem)=/.test(u.search), { timeout: 10000 })
    .catch(() => {});
  await p.waitForLoadState('domcontentloaded');
};

console.log('\n── 6d. The activity log and what reaches the owner ──');

await page.goto(`${BASE}/admin/logs`, { waitUntil: 'networkidle' });
t('The owner has an activity log to read', page.url().includes('/admin/logs'));
const logText = await page.locator('main').innerText();
t('  · it lists entries', /entr(y|ies)/i.test(logText));
t('  · and says where the reports are sent', /emailed to|Set OUTBOX|OWNER_EMAIL|written to/i.test(logText));

await page.goto(`${BASE}/admin/logs?area=access`, { waitUntil: 'networkidle' });
t('  · filtering by area works', /login|password/i.test(await page.locator('main').innerText()));

await page.goto(`${BASE}/admin/logs?q=zzz-nothing-matches-zzz`, { waitUntil: 'networkidle' });
t('  · a search with no matches says so', /nothing matches/i.test(await page.locator('main').innerText()));

{
  // A change an owner makes must produce an email to the owner address. With no
  // provider configured these land in data/outbox as readable files.
  const t0 = Date.now();
  await page.goto(`${BASE}/admin/staff`, { waitUntil: 'networkidle' });
  await page.locator('summary', { hasText: /Add someone/i }).first().click();
  await page.fill('#an', `E2E Audit ${stamp}`);
  await page.fill('#ae', `e2e.audit.${stamp}@zenryz-test.com`);
  await page.selectOption('#ar', 'staff');
  await page.selectOption('#ab', { index: 1 });
  await page.locator('button', { hasText: /^Add account$/ }).click();
  await settled();

  const banner = await page.locator('main').innerText();
  t('Adding a member of staff says what happened',
    new RegExp(`E2E Audit ${stamp} added as staff`).test(banner),
    banner.slice(0, 100).replace(/\n/g, ' | '));

  await new Promise(r => setTimeout(r, 1500));
  const mails = mailSince(t0);
  t('Creating an account emails the owner straight away',
    mails.some(m => /user\.create/.test(m)), `${mails.length} message(s) since`);
}

{
  // A manager with no branch must be refused rather than silently created.
  await page.goto(`${BASE}/admin/staff`, { waitUntil: 'networkidle' });
  await page.locator('summary', { hasText: /Add someone/i }).first().click();
  await page.fill('#an', `E2E NoBranch ${stamp}`);
  await page.fill('#ae', `e2e.refused.mgr.${stamp}@zenryz-test.com`);
  await page.selectOption('#ar', 'manager');
  await page.selectOption('#ab', '');
  await page.locator('button', { hasText: /^Add account$/ }).click();
  await settled();
  t('A manager cannot be saved without a restaurant',
    /attached to Birmingham or Leicester/i.test(await page.locator('main').innerText()));
  t('  · and no such account was created',
    q(`select id from users where email = 'e2e.refused.mgr.${stamp}@zenryz-test.com'`).length === 0);
}

console.log('\n── 6e. Admin forms answer back ──');

{
  const openBookingForm = async () => {
    await page.goto(`${BASE}/admin/bookings?branch=birmingham`, { waitUntil: 'networkidle' });
    await page.locator('summary', { hasText: /Log a phone or walk-in booking/i }).first().click();
    return page.locator('form:has(input[name="guestName"])').first();
  };

  const form = await openBookingForm();
  if (await form.count()) {
    await form.locator('input[name="guestName"]').fill(`E2E Guest ${stamp}`);
    await form.locator('input[name="date"]').fill('2020-01-01');
    await form.locator('input[name="time"]').fill('19:30');
    await form.locator('input[name="partySize"]').fill('4');
    await form.locator('button[type="submit"], button:not([type])').last().click();
    await settled();
    t('A booking in the past is refused, and says so',
      /already passed/i.test(await page.locator('main').innerText()));

    const f2 = await openBookingForm();
    await f2.locator('input[name="guestName"]').fill(`E2E Guest ${stamp}`);
    await f2.locator('input[name="date"]').fill(new Date(Date.now() + 864e5).toISOString().slice(0, 10));
    await f2.locator('input[name="time"]').fill('19:30');
    await f2.locator('input[name="partySize"]').fill('4');
    await f2.locator('button[type="submit"], button:not([type])').last().click();
    await settled();
    const okText = await page.locator('main').innerText();
    t('A good booking is confirmed on screen with its reference', /Reference V[BL]-/.test(okText),
      okText.slice(0, 120));
    t('  · and the booking exists',
      q(`select id from bookings where guest_name = 'E2E Guest ${stamp}'`).length === 1);
  } else {
    t('Booking form present on the admin bookings screen', false, 'form not found');
  }
}

{
  // Service times that would take every date off sale.
  await page.goto(`${BASE}/admin/settings`, { waitUntil: 'networkidle' });
  const first = page.locator('input[name="first"]');
  if (await first.count()) {
    const keepFirst = await first.inputValue();
    const keepLast = await page.locator('input[name="last"]').inputValue();
    await first.fill('22:00');
    await page.locator('input[name="last"]').fill('09:00');
    await page.locator('button', { hasText: /Save reservation rules/i }).click();
    await settled();
    t('Service times that close the restaurant are refused',
      /has to be after/i.test(await page.locator('main').innerText()));
    t('  · and nothing was saved',
      JSON.parse(q(`select value from settings where key='booking_rules'`)[0].value).slots.first === keepFirst,
      keepFirst);

    // Put it back the way it was, and prove a good save is acknowledged.
    await page.goto(`${BASE}/admin/settings`, { waitUntil: 'networkidle' });
    await page.locator('input[name="first"]').fill(keepFirst);
    await page.locator('input[name="last"]').fill(keepLast);
    await page.locator('button', { hasText: /Save reservation rules/i }).click();
    await settled();
    t('A good save is confirmed on screen',
      /Saved\./i.test(await page.locator('main').innerText()));
  }
}

console.log('\n── 7. Responsiveness ──');

for (const [label, w, h] of [['mobile 375', 375, 812], ['tablet 768', 768, 1024], ['desktop 1440', 1440, 900]]) {
  const p = await ctx.newPage();
  await p.setViewportSize({ width: w, height: h });
  for (const path of ['/', '/birmingham', '/birmingham/menu', '/birmingham/catering', '/birmingham/book-online', '/admin/enquiries']) {
    await p.goto(BASE + path, { waitUntil: 'networkidle' });
    const overflow = await p.evaluate(() =>
      Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - window.innerWidth);
    t(`${label}: ${path} has no sideways scroll`, overflow <= 1, overflow > 1 ? `${overflow}px over` : '');
  }
  await p.close();
}

{
  /* Sign out has to be reachable on the device it is used from. The admin rail
     scrolls sideways on a phone, and the whole rail used to scroll — putting
     "Sign out" 1,466px to the right of a 375px screen. It was in the markup and
     nobody could reach it, on a device shared at the pass. */
  const phone = await ctx.newPage();
  await phone.setViewportSize({ width: 375, height: 812 });
  await phone.goto(`${BASE}/admin`, { waitUntil: 'networkidle' });
  const box = await phone.locator('button', { hasText: /^Sign out$/ }).first().boundingBox();
  t('Sign out is on screen on a phone',
    !!box && box.x >= 0 && box.x + box.width <= 375 + 1,
    box ? `x=${Math.round(box.x)} w=${Math.round(box.width)}` : 'not found');
  await phone.close();
}

console.log('\n── 8. Console health ──');
t('No uncaught JavaScript errors during the run', errors.length === 0, errors.slice(0, 3).join(' | '));

// ---- tidy up the rows this run created ----
execFileSync('python3', ['-c', `
import sqlite3
db = sqlite3.connect('data/varanasi.db')
db.execute("delete from menu_items where name like 'E2E Dish %' or name like 'E2E Brum Only %' or name like 'E2E Leic Only %'")
db.execute("delete from menu_categories where name like 'E2E Section %'")
db.execute("delete from enquiries where email like 'e2e.%@zenryz-test.com'")
db.execute("delete from users where email like 'e2e.%@zenryz-test.com'")
db.execute("delete from bookings where guest_name like 'E2E Guest %'")
db.execute("delete from audit_log where action like 'login.%' and entity_id like 'e2e.%'")
db.execute("delete from audit_log where action in ('menu.category.create','enquiry.export') and detail like '%E2E%'")
db.commit()
`]);

await browser.close();

const failed = results.filter(r => !r.ok);
console.log(`\n${'─'.repeat(60)}`);
console.log(`${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) {
  console.log('\nFAILURES:');
  failed.forEach(f => console.log(`  · ${f.name}${f.detail ? ` — ${f.detail}` : ''}`));
  process.exit(1);
}
