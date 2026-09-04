"use server";
import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { settings, auditLog, branches } from "@/db/schema";
import { requireAbility } from "@/lib/auth";
import { bookingRules, SETTINGS_KEY, type BookingRules } from "@/lib/booking-config";
import { parsePounds } from "@/lib/money";
import { checkEmail } from "@/lib/validate";

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

export async function saveBookingRules(formData: FormData) {
  const session = await requireAbility("editSettings");
  const current = bookingRules();

  const policy = String(formData.get("depositPolicy") ?? current.deposit.policy);
  const next: BookingRules = {
    ...current,
    slots: {
      first: String(formData.get("first") || current.slots.first),
      last: String(formData.get("last") || current.slots.last),
      intervalMinutes: num(formData.get("interval"), current.slots.intervalMinutes),
    },
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
      to: lines(formData.get("notifyTo")),
      // Each falls back to what is already stored rather than to a blank, so
      // an empty box can never silently break sending.
      fromName: String(formData.get("fromName") ?? "").trim() || current.notifications.fromName,
      fromEmail: senderAddress(formData.get("fromEmail"), current.notifications.fromEmail),
      replyTo: senderAddress(formData.get("replyTo"), current.notifications.replyTo),
    },
  };

  save(next);
  db.insert(auditLog).values({
    userId: session.userId, action: "settings.booking", entity: "settings", entityId: SETTINGS_KEY,
    detail: `deposit ${next.deposit.policy} @ ${next.deposit.perPersonPence}p pp`,
  }).run();
}
