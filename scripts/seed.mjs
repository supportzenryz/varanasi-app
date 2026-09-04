import { DatabaseSync } from "node:sqlite";
import bcrypt from "bcryptjs";
import fs from "node:fs";

/** Hosts hand DATABASE_URL over as `file:/data/x.db`; SQLite wants a path. */
const rawUrl = (process.env.DATABASE_URL ?? "").trim();
const dbFile = rawUrl
  ? (rawUrl.startsWith("file:") ? rawUrl.slice(5) || "./data/varanasi.db" : rawUrl)
  : "./data/varanasi.db";

const db = new DatabaseSync(dbFile);
db.exec("PRAGMA busy_timeout = 15000");
db.exec("PRAGMA foreign_keys = ON");

const readJson = (f) => JSON.parse(fs.readFileSync(f, "utf8"));
const site = readJson("./data/site.json");
const roomData = readJson("./data/rooms.json");
const drinks = readJson("./data/drinks.json");

const slug = (s) => s.toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

/* --- CSV parse (quoted fields) --- */
function parseCsv(text) {
  const rows = []; let row = []; let cur = ""; let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; }
      else cur += c;
    } else if (c === '"') q = true;
    else if (c === ",") { row.push(cur); cur = ""; }
    else if (c === "\n") { row.push(cur); rows.push(row); row = []; cur = ""; }
    else if (c !== "\r") cur += c;
  }
  if (cur || row.length) { row.push(cur); rows.push(row); }
  return rows.filter((r) => r.some((c) => c !== ""));
}

const toPence = (p) => {
  const m = p.replace(/[^0-9.]/g, "");
  if (!m) return null;
  return Math.round(parseFloat(m) * 100);
};

/* dietary codes appear in the copy as "(g) (d)" or "(g,d)" */
const DIET = new Set(["g", "d", "n", "v", "vg", "sf", "e", "gf", "df"]);
function splitDietary(text) {
  const found = new Set();
  const clean = text.replace(/\(([a-z, ]+)\)/gi, (full, inner) => {
    const parts = inner.split(/[, ]+/).map((x) => x.trim().toLowerCase()).filter(Boolean);
    if (parts.length && parts.every((p) => DIET.has(p))) { parts.forEach((p) => found.add(p)); return ""; }
    return full;
  });
  return { clean: clean.replace(/\s{2,}/g, " ").replace(/\s+([.,])/g, "$1").trim(), codes: [...found].join(",") };
}

/* Children before parents: audit_log and the voucher/booking tables all carry
   foreign keys onto users and branches, so those have to go first or SQLite
   refuses the delete. This only bites once the admin has actually been used —
   an empty audit_log hides the ordering mistake. */
db.exec(`
  delete from audit_log;
  delete from voucher_redemptions;
  delete from vouchers;
  delete from enquiries;
  delete from bookings;
  delete from blocked_dates;
  delete from menu_items;
  delete from menu_categories;
  delete from private_rooms;
  delete from gallery_images;
  delete from branch_stats;
  delete from users;
  delete from branches;
  delete from settings;
`);

/* ---------- branches (details taken from the live capture, client to confirm) ---------- */
const hours = JSON.stringify([
  { day: "Monday", open: "17:00", close: "22:30" },
  { day: "Tuesday", open: "17:00", close: "22:30" },
  { day: "Wednesday", open: "17:00", close: "22:30" },
  { day: "Thursday", open: "17:00", close: "22:30" },
  { day: "Friday", open: "17:00", close: "23:00" },
  { day: "Saturday", open: "13:00", close: "23:00" },
  { day: "Sunday", open: "13:00", close: "22:00" },
]);

const insBranch = db.prepare(`insert into branches
  (slug,name,city,address_line,postcode,phone,email,maps_url,opening_hours,opening_note,
   hero_image,hero_video,hero_kicker,hero_heading,intro,
   about_heading,about_subheading,about_body,drinks_pdf,booking_email,press_email,is_published,sort)
  values (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1,?)`);

function addBranch(slugName, name, city, addressLine, postcode, phone, mapsUrl, intro, sort) {
  const c = site.branches[slugName];
  return Number(insBranch.run(
    slugName, name, city, addressLine, postcode, phone, c.bookingEmail, mapsUrl, hours, c.openingNote,
    c.heroImage, c.heroVideo, c.heroKicker, c.heroHeading, intro,
    c.aboutHeading, c.aboutSubheading, c.aboutBody, c.drinksPdf, c.bookingEmail, c.pressEmail, sort,
  ).lastInsertRowid);
}

const bhamId = addBranch("birmingham", "Varanasi Birmingham", "Birmingham",
  "184 Broad Street", "B15 1DA", "0121 633 3700",
  "https://maps.app.goo.gl/6YfRuLF8zsmqSZz46",
  "Eight private spaces, a kitchen built around the tandoor and the sigri, and a Broad Street dining room that has been feeding Birmingham since 2018.",
  1);

const leicId = addBranch("leicester", "Varanasi Leicester", "Leicester",
  "89-91 High Street", "LE1 4JB", "0116 251 8244", null,
  "A High Street dining room serving the same kitchen, with two private rooms for celebrations, corporate evenings and family gatherings.",
  2);

const branchIds = { birmingham: bhamId, leicester: leicId };

/* venue stat tiles and gallery, straight from the captured pages */
const insStat = db.prepare("insert into branch_stats (branch_id,value,label,image,href,sort) values (?,?,?,?,?,?)");
const insGallery = db.prepare("insert into gallery_images (branch_id,src,alt,is_featured,sort,is_published) values (?,?,?,?,?,1)");
let galleryCount = 0;
for (const [bslug, bid] of Object.entries(branchIds)) {
  const c = site.branches[bslug];
  c.stats.forEach((st, i) => insStat.run(bid, st.value, st.label, st.image ?? null, st.href ?? null, i));
  c.gallery.forEach((src, i) => { insGallery.run(bid, src, `Varanasi ${bslug === "birmingham" ? "Birmingham" : "Leicester"}`, i === 0 ? 1 : 0, i); galleryCount++; });
}

/* ---------- staff ---------- */
const insUser = db.prepare(`insert into users (email,password_hash,name,role,branch_id,is_active,must_change_password)
  values (?,?,?,?,?,1,?)`);
const placeholder = bcrypt.hashSync("ChangeMe!2026", 10);
insUser.run("owner@varanasi.uk", placeholder, "Varanasi Owner", "owner", null, 1);
insUser.run("birmingham@varanasi.uk", placeholder, "Birmingham Manager", "manager", bhamId, 1);
insUser.run("leicester@varanasi.uk", placeholder, "Leicester Manager", "manager", leicId, 1);

/* ---------- menus, from the 113 items recovered in the capture ---------- */
const rows = parseCsv(fs.readFileSync("./data/menu-items.csv", "utf8"));
const header = rows.shift();
const col = (name) => header.indexOf(name);

const insCat = db.prepare(`insert into menu_categories (branch_id,name,slug,kind,note,image,sort,is_published) values (?,?,?,?,?,?,?,1)`);
const insItem = db.prepare(`insert into menu_items
  (category_id,name,description,price_pence,measure,price_pence_2,measure_2,meta,dietary,is_published,sort)
  values (?,?,?,?,?,?,?,?,?,1,?)`);

const branchIdBySlug = branchIds;
const bannerFor = (bslug, i) => {
  const list = site.branches[bslug].menuBanners;
  return list[i % list.length];
};
const catCache = new Map();
let itemCount = 0, catCount = 0;
const sortIn = new Map();

for (const r of rows) {
  const branch = r[col("branch")];
  const branchId = branchIdBySlug[branch];
  if (!branchId) continue;
  const catName = r[col("category")].trim();
  if (!catName) continue;

  const key = `${branchId}::${catName}`;
  let catId = catCache.get(key);
  if (!catId) {
    const isSet = /set menu|dawat/i.test(catName);
    const n = catCount++;
    // a photo on every third section keeps the long list from reading as a wall of text
    const image = n % 3 === 2 ? bannerFor(branch, Math.floor(n / 3)) : null;
    catId = Number(insCat.run(branchId, catName, slug(catName), isSet ? "set" : "food",
      isSet ? "Served for the whole table" : null, image, n % 20).lastInsertRowid);
    catCache.set(key, catId);
  }

  // normalise the one-character discrepancy between the two branches
  let name = r[col("item")].trim().replace(/^Chutney Tray:/, "Chutney Trays:");
  const nameParts = splitDietary(name);
  const descParts = splitDietary(r[col("description")].trim());
  const dietary = [...new Set([...nameParts.codes.split(","), ...descParts.codes.split(",")].filter(Boolean))].join(",");

  const s = (sortIn.get(String(catId)) ?? 0);
  sortIn.set(String(catId), s + 1);
  insItem.run(catId, nameParts.clean, descParts.clean || null, toPence(r[col("price")]), null, null, null, null, dietary || null, s);
  itemCount++;
}

/* ---------- private dining ----------
   Every room, capacity, deposit and hire charge below is transcribed from the
   client's own live private-dining pages (data/rooms.json), replacing the
   guessed capacities in the first cut of this seed. Leicester genuinely has two
   rooms of its own — the old site's mistake was showing Birmingham's list on
   the Leicester page, not the room count.                                    */
const insRoom = db.prepare(`insert into private_rooms
  (branch_id,name,slug,headline,description,tagline,capacity_min,capacity_max,
   deposit_per_person_pence,hire_charge_pence,exclusivity_note,set_menu_note,ideal_for,
   image,image_blurred,sort,is_published)
  values (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1)`);

let roomCount = 0;
for (const [bslug, bid] of Object.entries(branchIds)) {
  (roomData[bslug] ?? []).forEach((r, i) => {
    insRoom.run(bid, r.name, slug(r.name), r.headline ?? null, r.description ?? null, r.tagline ?? null,
      r.capacityMin ?? null, r.capacityMax ?? null,
      r.depositPerPersonPence ?? null, r.hireChargePence ?? null,
      r.exclusivityNote ?? null, r.setMenuNote ?? null,
      r.idealFor ? JSON.stringify(r.idealFor) : null,
      r.image ?? null, r.imageBlurred ?? null, i);
    roomCount++;
  });
}

/* ---------- drinks, transcribed from Varanasi-Drinks-and-Cocktail-Menu.pdf ----------
   Loaded into the same menu tables as the food with kind="drinks", so the admin
   edits both through one screen and the PDF stops being the only source.     */
let drinkCats = 0, drinkItems = 0;
for (const bid of Object.values(branchIds)) {
  drinks.categories.forEach((cat, ci) => {
    const catId = Number(insCat.run(bid, cat.name, slug(cat.name), "drinks",
      cat.note ?? null, null, ci).lastInsertRowid);
    drinkCats++;
    cat.items.forEach((it, ii) => {
      insItem.run(catId, it.name, it.description ?? null,
        it.price ?? null, it.measure ?? null,
        it.price2 ?? null, it.measure2 ?? null,
        it.meta ?? null, null, ii);
      drinkItems++;
    });
  });
}

/* ---------- settings ---------- */
const insSetting = db.prepare("insert into settings (key,value) values (?,?)");
([
  ["voucher_expiry_months", "12"],
  ["voucher_values_pence", "[2500,5000,7500,10000,15000,20000]"],
  ["voucher_allow_custom", "true"],
  ["voucher_min_pence", "2500"],
  ["voucher_max_pence", "50000"],
  ["reservation_route", "custom"],
  ["marketing_list_double_optin", "true"],
  // The whole reservation rule set — slots, capacity, deposit policy,
  // occasions, allergens, consent wording and where alerts go. Editable in the
  // admin under Settings; data/booking.json is only the starting point.
  ["booking_rules", JSON.stringify(readJson("./data/booking.json"))],
]).forEach(([k, v]) => insSetting.run(k, v));

console.log(`branches 2 | staff 3 | food categories ${catCount} | food items ${itemCount}`);
console.log(`drinks categories ${drinkCats} | drinks ${drinkItems} | rooms ${roomCount} | gallery ${galleryCount}`);
