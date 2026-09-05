"use server";
import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { settings, branches } from "@/db/schema";
import { record } from "@/lib/audit";
import { requireAbility } from "@/lib/auth";
import { bookingRules, SETTINGS_KEY, type BookingRules } from "@/lib/booking-config";
import { parsePounds } from "@/lib/money";
import { checkEmail, checkPhone, checkTime } from "@/lib/validate";
import { ok, problem } from "@/lib/admin-feedback";

const num = (v: FormDataEntryValue | null, fallback: number) => {
  const n = Number(String(v ?? "").replace(/[^0-9]/g, ""));
  return Number.isFinite(n) && n > 0 ? n : fallback;
};
const lines = (v: FormDataEntryValue | null) =>
  String(v ?? "").split(/[\n,]/).map((s) => s.trim()).filter(Boolean);

function save(next: BookingRules) {
  const value = JSON.stringify(next, null, 2);
  const existing = db.select().from(settings).where(eq(settings.key, SETTINGS_KEY)).get();
  if (existing) {
    db.update(settings).set({ value, updatedAt: Math.floor(Date.now() / 1000) })
      .where(eq(settings.key, SETTINGS_KEY)).run();
  } else {
    db.insert(settings).values({ key: SETTINGS_KEY, value }).run();
  }
  // Availability and the booking form are read on every request, but the
  // branch pages that quote the deposit are prerendered.
  revalidatePath("/admin/settings");
  for (const b of db.select({ slug: branches.slug }).from(branches).all()) {
    revalidatePath(`/${b.slug}/book-online`);
    revalidatePath(`/${b.slug}`);
  }
}

/** Keeps the stored address when the new one isn't a usable email, so a typo
 *  in this box cannot stop every confirmation going out. */
function senderAddress(raw: FormDataEntryValue | null, fallback: string): string {
  const checked = checkEmail(String(raw ?? ""));
  return checked.ok ? checked.value : fallback;
}

/** Blank clears it; a usable number is stored; anything else keeps what was
 *  there, so a typo cannot silently switch the alerts off. */
function staffMobile(raw: FormDataEntryValue | null, fallback: string): string {
  const value = String(raw ?? "").trim();
  if (!value) return "";
  const checked = checkPhone(value, false);
  return checked.ok && checked.e164 ? checked.value : fallback;
}

const BACK = "/admin/settings";

export async function saveBookingRules(formData: FormData) {
  const session = await requireAbility("editSettings");
  const current = bookingRules();

  /* Two of these fields can take the restaurant off sale, and both used to do
     it in silence.

     Service times: `allSlots()` walks from `first` to `last` in steps. Save
     22:00 to 09:00 — a plausible typo for a late licence — and the loop
     produces no times at all, so every date on the website reports "fully
     booked". The page looks healthy. Nothing is bookable.

     Notification addresses: `to: lines(formData.get("notifyTo"))` took the box
     verbatim, so clearing it stopped every booking alert reaching the
     restaurant. Bookings kept arriving; nobody was told about them. */
  const first = String(formData.get("first") || current.slots.first);
  const last = String(formData.get("last") || current.slots.last);
  const t = checkTime(first);
  const t2 = checkTime(last);
  if (!t.ok) problem(BACK, `First sitting: ${t.error}`);
  if (!t2.ok) problem(BACK, `Last sitting: ${t2.error}`);
  if (t2.value <= t.value) {
    problem(BACK, `The last sitting (${t2.value}) has to be after the first (${t.value}). ` +
      `As entered, no time would be bookable on any date.`);
  }

  const notifyTo = lines(formData.get("notifyTo"));
  if (!notifyTo.length) {
    problem(BACK, "Someone has to receive the booking alerts. Leave at least one address here, " +
      "or the restaurant is never told a table has been booked.");
  }
  for (const address of notifyTo) {
    const checked = checkEmail(address);
    if (!checked.ok) problem(BACK, `"${address}" isn't an email address we can send to.`);
  }

  const interval = num(formData.get("interval"), current.slots.intervalMinutes);
  if (interval < 5 || interval > 240) {
    problem(BACK, "The gap between sittings should be between 5 and 240 minutes.");
  }

  const policy = String(formData.get("depositPolicy") ?? current.deposit.policy);
  const next: BookingRules = {
    ...current,
    slots: { first: t.value, last: t2.value, intervalMinutes: interval },
    capacity: {
      ...current.capacity,
      maxPartyOnline: num(formData.get("maxParty"), current.capacity.maxPartyOnline),
      coversPerSlot: Object.fromEntries(
        db.select({ slug: branches.slug }).from(branches).all().map((b) => [
          b.slug,
          num(formData.get(`covers_${b.slug}`), current.capacity.coversPerSlot[b.slug] ?? 30),
        ]),
      ),
    },
    leadTime: {
      minutesBefore: num(formData.get("leadMinutes"), current.leadTime.minutesBefore),
      maxDaysAhead: num(formData.get("maxDays"), current.leadTime.maxDaysAhead),
    },
    deposit: {
      ...current.deposit,
      policy: policy === "always" || policy === "nights" || policy === "off" ? policy : current.deposit.policy,
      perPersonPence: parsePounds(String(formData.get("perPerson") ?? "")) ?? current.deposit.perPersonPence,
      minParty: num(formData.get("minParty"), current.deposit.minParty),
      holdMinutes: num(formData.get("holdMinutes"), current.deposit.holdMinutes),
      note: String(formData.get("depositNote") ?? current.deposit.note),
    },
    occasions: { options: lines(formData.get("occasions")).length ? lines(formData.get("occasions")) : current.occasions.options },
    notifications: {
      ...current.notifications,
      to: notifyTo.map((a) => a.toLowerCase()),
      // Each falls back to what is already stored rather than to a blank, so
      // an empty box can never silently break sending.
      fromName: String(formData.get("fromName") ?? "").trim() || current.notifications.fromName,
      fromEmail: senderAddress(formData.get("fromEmail"), current.notifications.fromEmail),
      replyTo: senderAddress(formData.get("replyTo"), current.notifications.replyTo),
    },
    whatsapp: {
      ...current.whatsapp,
      // Blank is a real choice (no alerts), so this one does not fall back —
      // but anything that is not a dialable number is refused rather than
      // stored, since a half-typed mobile is an alert nobody receives.
      notifyTo: staffMobile(formData.get("waNotifyTo"), current.whatsapp?.notifyTo ?? ""),
    },
  };

  save(next);
  record(session, {
    action: "settings.booking", entity: "settings", entityId: SETTINGS_KEY,
    detail: `deposit ${next.deposit.policy} @ ${next.deposit.perPersonPence}p pp, ` +
      `service ${next.slots.first}–${next.slots.last}, notify ${next.notifications.to.join(", ") || "nobody"}`,
  });

  // Say so, and say what actually landed. Saving used to re-render the same
  // page with nothing changed on screen, which is indistinguishable from a
  // button that does not work — and the honest reading of a silent form is
  // that it failed.
  ok(BACK, `Saved. Service ${t.value}–${t2.value} every ${interval} minutes; ` +
    `deposit ${next.deposit.policy === "off" ? "off" : `${next.deposit.policy}, ` +
      `${(next.deposit.perPersonPence / 100).toFixed(2)} per person`}; ` +
    `alerts to ${notifyTo.join(", ")}.`);
}
