import { sqliteTable, text, integer, uniqueIndex, index } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

const now = sql`(strftime('%s','now'))`;

/* ---------- branches ---------- */
export const branches = sqliteTable("branches", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  slug: text("slug").notNull(),                 // "birmingham" | "leicester"
  name: text("name").notNull(),                 // "Varanasi Birmingham"
  city: text("city").notNull(),
  addressLine: text("address_line").notNull(),
  postcode: text("postcode").notNull(),
  phone: text("phone").notNull(),
  email: text("email"),
  mapsUrl: text("maps_url"),
  openingHours: text("opening_hours"),          // JSON: [{day,open,close,closed}]
  openingNote: text("opening_note"),            // "(Last orders 10pm)"
  heroImage: text("hero_image"),                // full-cover still (Leicester uses this)
  heroVideo: text("hero_video"),                // full-cover video (Birmingham uses this)
  heroKicker: text("hero_kicker"),              // "Artistry in Every Bite"
  heroHeading: text("hero_heading"),            // "Indian Fine Dining Restaurant in ..."
  intro: text("intro"),
  aboutHeading: text("about_heading"),          // "Varanasi's Modern Twist on Tradition"
  aboutSubheading: text("about_subheading"),
  aboutBody: text("about_body"),
  drinksPdf: text("drinks_pdf"),                // downloadable drinks & cocktail menu
  bookingEmail: text("booking_email"),
  pressEmail: text("press_email"),
  isPublished: integer("is_published", { mode: "boolean" }).notNull().default(true),
  sort: integer("sort").notNull().default(0),
}, (t) => ({ slugIdx: uniqueIndex("branches_slug_idx").on(t.slug) }));

/* Venue stat tiles on the branch home ("1 Unique Venue", "3 Cocktail Bars"). */
export const branchStats = sqliteTable("branch_stats", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  branchId: integer("branch_id").notNull().references(() => branches.id, { onDelete: "cascade" }),
  value: text("value").notNull(),               // "3"
  label: text("label").notNull(),               // "Cocktail Bars"
  image: text("image"),
  href: text("href"),
  sort: integer("sort").notNull().default(0),
}, (t) => ({ branchIdx: index("branch_stats_branch_idx").on(t.branchId) }));

/* Gallery images per branch, shown on the gallery page and the home collage. */
export const galleryImages = sqliteTable("gallery_images", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  branchId: integer("branch_id").notNull().references(() => branches.id, { onDelete: "cascade" }),
  src: text("src").notNull(),
  alt: text("alt"),
  /* The file's real pixel size, recorded when it is imported. The gallery gives
     some tiles four times the area of the others and one tile the full width of
     the page, and without this it was handing those slots out by position — so
     a 201px thumbnail could end up stretched across fourteen hundred pixels.
     Null means unknown, which the layout treats as "safe to enlarge", the
     behaviour it had before any of this was recorded. */
  width: integer("width"),
  height: integer("height"),
  isFeatured: integer("is_featured", { mode: "boolean" }).notNull().default(false),
  sort: integer("sort").notNull().default(0),
  isPublished: integer("is_published", { mode: "boolean" }).notNull().default(true),
}, (t) => ({ branchIdx: index("gallery_images_branch_idx").on(t.branchId) }));

/* ---------- staff ---------- */
// owner   = everything, including staff accounts and payment settings
// manager = own branch: menus, rooms, blocked dates, bookings, vouchers, enquiries
// staff   = own branch: look up and redeem vouchers, read enquiries. No editing.
export const users = sqliteTable("users", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  email: text("email").notNull(),
  passwordHash: text("password_hash").notNull(),
  name: text("name").notNull(),
  role: text("role", { enum: ["owner", "manager", "staff"] }).notNull().default("staff"),
  branchId: integer("branch_id").references(() => branches.id), // null = all branches
  isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
  mustChangePassword: integer("must_change_password", { mode: "boolean" }).notNull().default(false),
  lastLoginAt: integer("last_login_at"),
  createdAt: integer("created_at").notNull().default(now),
}, (t) => ({ emailIdx: uniqueIndex("users_email_idx").on(t.email) }));

/**
 * One-time links for "I've forgotten my password".
 *
 * Only a hash of the token is stored, never the token. If this database is
 * ever read by someone who shouldn't have it — a stolen backup, a support
 * request answered carelessly — the rows in here are useless to them: the
 * link that would actually let you in exists only in the email that was sent
 * and in the recipient's inbox.
 *
 * A row is spent (`usedAt`) rather than deleted, so the audit trail can show
 * that a reset happened, when, and from where.
 */
export const passwordResets = sqliteTable("password_resets", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  /** sha256 of the token that went out in the email */
  tokenHash: text("token_hash").notNull(),
  expiresAt: integer("expires_at").notNull(),
  usedAt: integer("used_at"),
  /** who asked — kept so a flood of requests can be recognised as one */
  requestedIp: text("requested_ip"),
  createdAt: integer("created_at").notNull().default(now),
}, (t) => ({
  tokenIdx: uniqueIndex("password_resets_token_idx").on(t.tokenHash),
  userIdx: index("password_resets_user_idx").on(t.userId),
}));

/**
 * How many times something has been tried lately, and by whom.
 *
 * The login throttle lived in a `Map` in the server process. That works, right
 * up to the two moments it matters: a deploy (every counter forgotten, so an
 * attacker who has been locked out waits for the next release), and a second
 * instance (each process counts its own attempts, so the real limit is
 * whatever it was times the number of instances). It also could not be used
 * for the public forms, which had no limit at all — an enquiry form that sends
 * an email on every submission is a way to empty the restaurant's email quota
 * and fill its inbox from a laptop.
 *
 * A row per key, in the database everything else already lives in. One small
 * write per attempt, which is nothing next to the bcrypt comparison it is
 * protecting.
 */
export const rateLimits = sqliteTable("rate_limits", {
  /** what is being counted: "login:email:sam@…", "enquiry:ip:1.2.3.4" */
  key: text("key").primaryKey(),
  count: integer("count").notNull().default(0),
  windowStart: integer("window_start").notNull(),
  /** set once the limit is crossed; until then, null */
  blockedUntil: integer("blocked_until"),
});

/* ---------- menu ---------- */
export const menuCategories = sqliteTable("menu_categories", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  branchId: integer("branch_id").notNull().references(() => branches.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  slug: text("slug").notNull(),
  // "food" and "drinks" render as two separate menus; "set" is the tasting menus
  kind: text("kind", { enum: ["food", "drinks", "set"] }).notNull().default("food"),
  description: text("description"),
  note: text("note"),                            // e.g. "Set menu, minimum 2 guests"
  image: text("image"),                          // section banner photo
  pricePence: integer("price_pence"),            // set menus carry one price for the whole menu
  sort: integer("sort").notNull().default(0),
  isPublished: integer("is_published", { mode: "boolean" }).notNull().default(true),
}, (t) => ({ branchIdx: index("menu_categories_branch_idx").on(t.branchId) }));

export const menuItems = sqliteTable("menu_items", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  categoryId: integer("category_id").notNull().references(() => menuCategories.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  description: text("description"),
  pricePence: integer("price_pence"),            // null = "market price" / included in set menu
  measure: text("measure"),                      // drinks: "175ml", "50ml", "75cl"
  pricePence2: integer("price_pence_2"),         // drinks: second measure, e.g. bottle
  measure2: text("measure_2"),                   // "75cl", "Bottle"
  meta: text("meta"),                            // wine origin/style: "Italy ( VG / 3 / L )"
  dietary: text("dietary"),                      // csv of g,d,n,v,vg,sf,e
  isSignature: integer("is_signature", { mode: "boolean" }).notNull().default(false),
  isPublished: integer("is_published", { mode: "boolean" }).notNull().default(true),
  sort: integer("sort").notNull().default(0),
}, (t) => ({ catIdx: index("menu_items_category_idx").on(t.categoryId) }));

/* ---------- private dining ---------- */
export const privateRooms = sqliteTable("private_rooms", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  branchId: integer("branch_id").notNull().references(() => branches.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  slug: text("slug").notNull(),
  headline: text("headline"),                    // "A Formal, Private Business Environment"
  description: text("description"),
  tagline: text("tagline"),                      // short line used on cards
  capacityMin: integer("capacity_min"),
  capacityMax: integer("capacity_max"),
  depositPerPersonPence: integer("deposit_per_person_pence"),
  hireChargePence: integer("hire_charge_pence"),
  exclusivityNote: text("exclusivity_note"),     // "Charges apply"
  setMenuNote: text("set_menu_note"),            // "Dawat Set Menu at £65.00 per person"
  idealFor: text("ideal_for"),                   // JSON array of occasions
  minSpendPence: integer("min_spend_pence"),
  image: text("image"),
  imageBlurred: text("image_blurred"),
  sort: integer("sort").notNull().default(0),
  isPublished: integer("is_published", { mode: "boolean" }).notNull().default(true),
}, (t) => ({ branchIdx: index("private_rooms_branch_idx").on(t.branchId) }));

/**
 * The pictures on a room's own page.
 *
 * `private_rooms.image` stays as the one photograph the cards and the listing
 * use, so nothing that already reads it has to change. This table is the rest:
 * the other angles of the same room, and the 360° panorama if one has been
 * shot.
 *
 * `kind` distinguishes them because they are not interchangeable. A `photo` is
 * a normal picture and goes in the grid. A `panorama` is an equirectangular
 * frame — a single very wide image, 2:1, that means nothing on its own and is
 * only correct inside the viewer that wraps it round a sphere. Putting one in
 * the grid by mistake shows a smeared, unreadable strip, so the two are kept
 * apart in the data rather than guessed at from the file name.
 */
export const roomImages = sqliteTable("room_images", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  roomId: integer("room_id").notNull().references(() => privateRooms.id, { onDelete: "cascade" }),
  src: text("src").notNull(),
  alt: text("alt"),
  kind: text("kind", { enum: ["photo", "panorama"] }).notNull().default("photo"),
  /** What the viewer is looking at when a panorama opens, in degrees. Lets the
   *  room face its best wall instead of wherever the camera happened to point. */
  headingDeg: integer("heading_deg").notNull().default(0),
  sort: integer("sort").notNull().default(0),
}, (t) => ({ roomIdx: index("room_images_room_idx").on(t.roomId) }));

/* ---------- availability control ---------- */
export const blockedDates = sqliteTable("blocked_dates", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  branchId: integer("branch_id").notNull().references(() => branches.id, { onDelete: "cascade" }),
  date: text("date").notNull(),                  // ISO yyyy-mm-dd
  allDay: integer("all_day", { mode: "boolean" }).notNull().default(true),
  fromTime: text("from_time"),
  toTime: text("to_time"),
  roomId: integer("room_id").references(() => privateRooms.id, { onDelete: "cascade" }),
  reason: text("reason"),
  createdAt: integer("created_at").notNull().default(now),
}, (t) => ({ dateIdx: index("blocked_dates_branch_date_idx").on(t.branchId, t.date) }));

/* ---------- vouchers ---------- */
export const vouchers = sqliteTable("vouchers", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  code: text("code").notNull(),                  // unguessable, generated
  valuePence: integer("value_pence").notNull(),
  balancePence: integer("balance_pence").notNull(),
  status: text("status", { enum: ["pending", "active", "redeemed", "expired", "cancelled"] })
    .notNull().default("pending"),
  purchaserName: text("purchaser_name"),
  purchaserEmail: text("purchaser_email"),
  recipientName: text("recipient_name"),
  recipientEmail: text("recipient_email"),
  message: text("message"),
  branchId: integer("branch_id").references(() => branches.id), // null = valid at both
  stripeSessionId: text("stripe_session_id"),
  stripePaymentIntent: text("stripe_payment_intent"),
  issuedAt: integer("issued_at"),
  expiresAt: integer("expires_at"),
  /* A voucher can be bought for a future date ("send it on her birthday"), so
     delivery is separate from purchase. */
  deliverOn: text("deliver_on"),                 // ISO yyyy-mm-dd, null = at once
  deliveredAt: integer("delivered_at"),
  /* "purchase" = bought on the site, "manual" = issued by staff,
     "thank_you" = the complimentary one sent after a guest has dined. */
  origin: text("origin", { enum: ["purchase", "manual", "thank_you"] }).notNull().default("purchase"),
  bookingId: integer("booking_id"),              // set for thank-you vouchers
  createdAt: integer("created_at").notNull().default(now),
}, (t) => ({
  codeIdx: uniqueIndex("vouchers_code_idx").on(t.code),
  statusIdx: index("vouchers_status_idx").on(t.status),
  /* Same reasoning as bookings: the Stripe return path, and the admin list
     that orders by newest. */
  sessionIdx: index("vouchers_session_idx").on(t.stripeSessionId),
  createdIdx: index("vouchers_created_idx").on(t.createdAt),
}));

export const voucherRedemptions = sqliteTable("voucher_redemptions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  voucherId: integer("voucher_id").notNull().references(() => vouchers.id, { onDelete: "cascade" }),
  amountPence: integer("amount_pence").notNull(),
  balanceAfterPence: integer("balance_after_pence").notNull(),
  branchId: integer("branch_id").references(() => branches.id),
  redeemedByUserId: integer("redeemed_by_user_id").references(() => users.id),
  note: text("note"),
  createdAt: integer("created_at").notNull().default(now),
}, (t) => ({ voucherIdx: index("voucher_redemptions_voucher_idx").on(t.voucherId) }));

/* ---------- enquiries (what the old forms produced) ---------- */
export const enquiries = sqliteTable("enquiries", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  branchId: integer("branch_id").references(() => branches.id),
  type: text("type", { enum: ["booking", "private_room", "corporate", "catering", "contact", "franchise"] })
    .notNull(),
  name: text("name").notNull(),
  email: text("email"),
  phone: text("phone"),
  company: text("company"),
  partySize: integer("party_size"),
  requestedDate: text("requested_date"),
  requestedTime: text("requested_time"),
  occasion: text("occasion"),
  roomId: integer("room_id").references(() => privateRooms.id),
  dietary: text("dietary"),
  message: text("message"),
  marketingConsent: integer("marketing_consent", { mode: "boolean" }).notNull().default(false),
  termsAcceptedAt: integer("terms_accepted_at"),
  status: text("status", { enum: ["new", "contacted", "confirmed", "closed"] }).notNull().default("new"),
  handledByUserId: integer("handled_by_user_id").references(() => users.id),
  internalNote: text("internal_note"),
  createdAt: integer("created_at").notNull().default(now),
}, (t) => ({
  branchIdx: index("enquiries_branch_idx").on(t.branchId),
  statusIdx: index("enquiries_status_idx").on(t.status),
}));

/* ---------- bookings ----------
 * A website booking is created `held` with `deposit_status = required`, and only
 * becomes `confirmed` when Stripe tells us the deposit is paid. A hold that is
 * never paid for expires (`hold_expires_at`) and stops occupying its slot, so an
 * abandoned checkout can't quietly block a table all evening.
 */
export const bookings = sqliteTable("bookings", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  reference: text("reference").notNull(),
  branchId: integer("branch_id").notNull().references(() => branches.id),
  guestName: text("guest_name").notNull(),
  email: text("email"),
  phone: text("phone"),
  partySize: integer("party_size").notNull(),
  date: text("date").notNull(),
  time: text("time").notNull(),
  roomId: integer("room_id").references(() => privateRooms.id),
  occasion: text("occasion"),
  dietary: text("dietary"),                      // csv of the allergen labels
  notes: text("notes"),
  status: text("status", { enum: ["held", "confirmed", "seated", "completed", "cancelled", "no_show"] })
    .notNull().default("confirmed"),
  depositPence: integer("deposit_pence"),
  depositStatus: text("deposit_status", { enum: ["none", "required", "authorised", "captured", "refunded", "failed"] })
    .notNull().default("none"),
  stripePaymentIntent: text("stripe_payment_intent"),
  stripeSessionId: text("stripe_session_id"),    // the Checkout Session we sent them to
  depositPaidAt: integer("deposit_paid_at"),
  holdExpiresAt: integer("hold_expires_at"),     // unpaid holds stop blocking the slot
  marketingConsent: integer("marketing_consent", { mode: "boolean" }).notNull().default(false),
  termsAcceptedAt: integer("terms_accepted_at"), // the three required consents, timestamped
  cancelToken: text("cancel_token"),             // lets a guest manage their own booking
  /* The after-dining message: a Google review link and a complimentary voucher.
     Stamped so a booking re-marked completed doesn't send it twice. */
  followUpSentAt: integer("follow_up_sent_at"),
  whatsappOptIn: integer("whatsapp_opt_in", { mode: "boolean" }).notNull().default(false),
  source: text("source", { enum: ["website", "phone", "walk_in", "platform"] }).notNull().default("website"),
  createdAt: integer("created_at").notNull().default(now),
}, (t) => ({
  refIdx: uniqueIndex("bookings_reference_idx").on(t.reference),
  dateIdx: index("bookings_branch_date_idx").on(t.branchId, t.date),
  /* `expireStaleHolds()` runs on every view of /book-online and every load of
     the admin bookings screen, and without this it is a full scan of the
     table — the one query on the money path that gets slower every month the
     restaurant trades. */
  holdIdx: index("bookings_status_hold_idx").on(t.status, t.holdExpiresAt),
  /* Looked up once per webhook and once per return from Stripe: the moments a
     guest is watching a spinner having just paid. */
  sessionIdx: index("bookings_session_idx").on(t.stripeSessionId),
}));

/* ---------- settings & audit ---------- */
export const settings = sqliteTable("settings", {
  key: text("key").primaryKey(),
  value: text("value"),
  updatedAt: integer("updated_at").notNull().default(now),
});

export const auditLog = sqliteTable("audit_log", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: integer("user_id").references(() => users.id),
  /* Who did it when it was not a member of staff: a guest's name, "scheduler",
     "Stripe". Null for staff, whose name comes from user_id. */
  actor: text("actor"),
  action: text("action").notNull(),
  entity: text("entity").notNull(),
  entityId: text("entity_id"),
  detail: text("detail"),
  createdAt: integer("created_at").notNull().default(now),
}, (t) => ({ createdIdx: index("audit_log_created_idx").on(t.createdAt) }));

/* ---------- marketing ----------
 * Consent is a fact with a history, not a boolean on a booking.
 *
 * A `marketing_consent` column on `bookings` says the box was ticked. It
 * cannot say when, on which form, or against what wording — and it cannot
 * hold an unsubscribe, because the booking it hangs off may since have been
 * anonymised for an erasure request while the person's wish not to be emailed
 * still has to be honoured. Under PECR the restaurant has to be able to show
 * that a given address agreed; this table is that evidence.
 *
 * Nothing is ever deleted here. Unsubscribing stamps `unsubscribedAt`, so a
 * later booking from the same address cannot quietly put someone back on a
 * list they asked to leave.
 */
export const marketingContacts = sqliteTable("marketing_contacts", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  email: text("email").notNull(),
  name: text("name"),
  branchId: integer("branch_id").references(() => branches.id),
  source: text("source", { enum: ["booking", "enquiry", "voucher", "manual"] }).notNull(),
  /** The exact sentence they agreed to, kept verbatim. */
  consentText: text("consent_text"),
  consentedAt: integer("consented_at").notNull(),
  consentIp: text("consent_ip"),
  unsubscribedAt: integer("unsubscribed_at"),
  /** In the footer of every email. Long enough that it cannot be guessed. */
  unsubscribeToken: text("unsubscribe_token").notNull(),
  lastSentAt: integer("last_sent_at"),
  createdAt: integer("created_at").notNull().default(now),
}, (t) => ({
  emailIdx: uniqueIndex("marketing_contacts_email_idx").on(t.email),
  tokenIdx: uniqueIndex("marketing_contacts_token_idx").on(t.unsubscribeToken),
}));

/** One weekly email, from the draft the scheduler prepares to the send an
 *  owner authorises. Nothing leaves without a person pressing a button. */
export const campaigns = sqliteTable("campaigns", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  subject: text("subject").notNull(),
  preheader: text("preheader"),
  body: text("body").notNull(),
  status: text("status", { enum: ["draft", "sending", "sent", "cancelled"] })
    .notNull().default("draft"),
  /** Null means both restaurants. */
  branchId: integer("branch_id").references(() => branches.id),
  /** The Monday this was prepared for, YYYY-MM-DD. Unique, so the scheduler
   *  cannot prepare the same week twice however often it runs. */
  weekOf: text("week_of"),
  preparedBy: text("prepared_by"),
  sentByUserId: integer("sent_by_user_id").references(() => users.id),
  sentAt: integer("sent_at"),
  recipientCount: integer("recipient_count").notNull().default(0),
  failedCount: integer("failed_count").notNull().default(0),
  createdAt: integer("created_at").notNull().default(now),
  updatedAt: integer("updated_at").notNull().default(now),
}, (t) => ({ weekIdx: uniqueIndex("campaigns_week_idx").on(t.weekOf) }));

/** A one-shot admin banner. See src/lib/flash.ts for why it is not in the URL. */
export const notices = sqliteTable("notices", {
  id: text("id").primaryKey(),
  kind: text("kind", { enum: ["ok", "problem"] }).notNull(),
  message: text("message").notNull(),
  /** What the screen was looking at — the voucher code, for instance — so it
   *  can be put back on screen without travelling through the URL. */
  context: text("context"),
  createdAt: integer("created_at").notNull().default(now),
});
