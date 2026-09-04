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
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
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

console.log('\n── 8. Console health ──');
t('No uncaught JavaScript errors during the run', errors.length === 0, errors.slice(0, 3).join(' | '));

// ---- tidy up the rows this run created ----
execFileSync('python3', ['-c', `
import sqlite3
db = sqlite3.connect('data/varanasi.db')
db.execute("delete from menu_items where name like 'E2E Dish %'")
db.execute("delete from menu_categories where name like 'E2E Section %'")
db.execute("delete from enquiries where email like 'e2e.%@zenryz-test.com'")
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
