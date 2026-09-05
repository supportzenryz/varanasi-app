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
  action: text("action").notNull(),
  entity: text("entity").notNull(),
  entityId: text("entity_id"),
  detail: text("detail"),
  createdAt: integer("created_at").notNull().default(now),
}, (t) => ({ createdIdx: index("audit_log_created_idx").on(t.createdAt) }));
