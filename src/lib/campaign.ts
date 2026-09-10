import "server-only";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { campaigns, marketingContacts, menuCategories, menuItems, privateRooms } from "@/db/schema";
import { allBranches } from "@/lib/branches";
import { formatPence } from "@/lib/money";
import { sendMail } from "@/lib/email";
import { audience, campaignById, weekOf, type Campaign, type Contact } from "@/lib/marketing";
import { siteUrl } from "@/lib/site";

/**
 * Preparing the weekly email, and sending it once somebody has read it.
 *
 * The draft is assembled from what is actually on the site this week — a
 * signature dish with its real price, a private room with its real capacity,
 * the branches that are actually published — rather than from a template with
 * gaps in it. That matters for a reason beyond tidiness: an owner presented
 * with "[INSERT DISH HERE]" writes nothing and the email never goes, whereas
 * an owner presented with a finished paragraph about their own tasting menu
 * changes two words and presses send. The draft's job is to make sending
 * easier than not sending.
 *
 * Everything it produces is editable before it leaves. Nothing is sent by the
 * scheduler; `send` runs only from an owner pressing a button.
 */

const nowSec = () => Math.floor(Date.now() / 1000);

/* --------------------------------------------------------------- draft -- */

/** A dish worth writing about: signature first, priced, published. */
function highlightDish(branchId: number): { name: string; description: string | null; price: string } | null {
  const row = db.select({
    name: menuItems.name, description: menuItems.description, pricePence: menuItems.pricePence,
  }).from(menuItems)
    .innerJoin(menuCategories, eq(menuCategories.id, menuItems.categoryId))
    .where(and(
      eq(menuCategories.branchId, branchId),
      eq(menuCategories.kind, "food"),
      eq(menuItems.isPublished, true),
      eq(menuItems.isSignature, true),
    ))
    /* Rotated by week rather than fixed, so a restaurant that sends this every
       Monday is not writing about the same dish for a year. The week number
       picks the offset; no state is stored and the choice is reproducible. */
    .orderBy(sql`${menuItems.id}`)
    .all()
    .filter((r) => r.pricePence != null);

  if (!row.length) return null;
  const week = Number(weekOf().replaceAll("-", "")) % row.length;
  const pick = row[week];
  return { name: pick.name, description: pick.description, price: formatPence(pick.pricePence!) };
}

function highlightRoom(branchId: number): { name: string; max: number | null } | null {
  const rooms = db.select({ name: privateRooms.name, capacityMax: privateRooms.capacityMax })
    .from(privateRooms)
    .where(and(eq(privateRooms.branchId, branchId), eq(privateRooms.isPublished, true)))
    .all();
  if (!rooms.length) return null;
  const week = Number(weekOf().replaceAll("-", "")) % rooms.length;
  return { name: rooms[week].name, max: rooms[week].capacityMax };
}

/**
 * Compose this week's draft.
 *
 * Plain text on purpose. The owner is going to edit it in a textarea, and a
 * body full of HTML tags is a body nobody edits — they open it, see markup,
 * and close it again. It is rendered to simple HTML at send time.
 */
export function composeDraft(opts: { branchId?: number | null } = {}): {
  subject: string; preheader: string; body: string;
} {
  const site = siteUrl();
  const branchList = allBranches();
  const chosen = opts.branchId ? branchList.filter((b) => b.id === opts.branchId) : branchList;
  const primary = chosen[0];

  const dish = primary ? highlightDish(primary.id) : null;
  const room = primary ? highlightRoom(primary.id) : null;

  const subject = dish
    ? `This week at Varanasi — ${dish.name}`
    : "This week at Varanasi";

  const preheader = dish
    ? `${dish.name}, ${dish.price}, and a table whenever suits you.`
    : "What's on this week, and how to book.";

  const lines: string[] = [];
  lines.push("Dear {{name}},", "");
  lines.push("A few things worth knowing about this week.", "");

  if (dish) {
    lines.push(`FROM THE KITCHEN`, "");
    lines.push(`${dish.name} — ${dish.price}`);
    if (dish.description) lines.push(dish.description);
    lines.push("");
  }

  if (room && chosen.length === 1) {
    lines.push("PRIVATE DINING", "");
    lines.push(
      `${room.name}${room.max ? `, seating up to ${room.max}` : ""}, is available for `
      + "celebrations and business dinners.",
      `${site}/${primary.slug}/private-dining-experiences`,
      "",
    );
  }

  lines.push("BOOK A TABLE", "");
  for (const b of chosen) {
    lines.push(`${b.name} — ${b.addressLine}, ${b.postcode} — ${b.phone}`);
    lines.push(`${site}/${b.slug}/book-online`);
  }
  lines.push("");
  lines.push("Gift vouchers are available online and can be sent on any date you choose.");
  lines.push(`${site}/${chosen[0]?.slug ?? "birmingham"}/gift-vouchers`);
  lines.push("");
  lines.push("With warm regards,");
  lines.push("The team at Varanasi");

  return { subject, preheader, body: lines.join("\n") };
}

/**
 * Prepare the week's draft if one does not already exist.
 *
 * Returns null when this week has already been prepared — `week_of` is unique
 * in the table, so the scheduler running hourly cannot produce seven drafts by
 * Sunday, and a restart cannot produce a second one an hour later.
 */
export function prepareWeeklyDraft(): Campaign | null {
  const week = weekOf();
  const existing = db.select().from(campaigns).where(eq(campaigns.weekOf, week)).get();
  if (existing) return null;

  const { subject, preheader, body } = composeDraft();
  db.insert(campaigns).values({
    subject, preheader, body,
    status: "draft",
    branchId: null,
    weekOf: week,
    preparedBy: "scheduler",
  }).run();

  const made = db.select().from(campaigns).where(eq(campaigns.weekOf, week)).get()!;
  console.log(`[marketing] draft prepared for week of ${week} — waiting for an owner to send it`);
  return made;
}

/* ---------------------------------------------------------------- send -- */

/** `{{name}}` becomes the person's first name, or a courteous fallback. */
function personalise(body: string, c: Contact): string {
  const first = (c.name ?? "").trim().split(/\s+/)[0];
  return body.replaceAll("{{name}}", first || "there");
}

function htmlFrom(text: string, unsubscribeUrl: string): string {
  const esc = (s: string) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const body = esc(text)
    .split(/\n{2,}/)
    .map((para) => {
      /* A line in capitals on its own is a section heading in the plain-text
         draft; render it as one rather than shouting in the HTML. */
      if (/^[A-Z][A-Z —'-]{3,}$/.test(para.trim())) {
        return `<p style="margin:28px 0 8px;font:600 12px/1.4 Helvetica,Arial,sans-serif;`
          + `letter-spacing:.16em;color:#B69112;text-transform:uppercase">${para.trim()}</p>`;
      }
      const withLinks = para.replace(
        /(https?:\/\/[^\s<]+)/g,
        '<a href="$1" style="color:#B69112">$1</a>',
      );
      return `<p style="margin:0 0 16px;font:400 15px/1.65 Georgia,serif;color:#1a1a18">`
        + `${withLinks.replace(/\n/g, "<br>")}</p>`;
    })
    .join("");

  return `<!doctype html><html><body style="margin:0;background:#F5F9E9;padding:28px 16px">
<div style="max-width:38rem;margin:0 auto;background:#fff;padding:32px 30px;border-top:3px solid #E9BA20">
<p style="margin:0 0 24px;font:400 22px/1.2 Georgia,serif;letter-spacing:.02em;color:#0F0F0F">Varanasi</p>
${body}
<p style="margin:32px 0 0;padding-top:16px;border-top:1px solid #E4EACF;font:400 12px/1.6 Helvetica,Arial,sans-serif;color:#6b6f63">
You are receiving this because you asked to hear from us when you booked or enquired.
<a href="${unsubscribeUrl}" style="color:#6b6f63">Unsubscribe</a> — one click, no questions.
</p>
</div></body></html>`;
}

export type SendResult = { ok: boolean; sent: number; failed: number; error?: string };

/**
 * Send a draft to the list.
 *
 * Marked `sending` before the first message goes out and `sent` after the
 * last, so a second press of the button — or a browser resend — finds a
 * campaign that is no longer a draft and does nothing. Sending the same
 * newsletter twice to the whole list is the single most embarrassing thing
 * this feature could do.
 */
export async function sendCampaign(id: number, sentByUserId: number): Promise<SendResult> {
  const c = campaignById(id);
  if (!c) return { ok: false, sent: 0, failed: 0, error: "That campaign no longer exists." };
  if (c.status !== "draft") {
    return { ok: false, sent: 0, failed: 0,
      error: c.status === "sent" ? "That one has already been sent." : `It is already ${c.status}.` };
  }

  const people = audience(c.branchId);
  if (!people.length) {
    return { ok: false, sent: 0, failed: 0,
      error: "Nobody has agreed to marketing yet, so there is no one to send to." };
  }

  /* Claim it first, conditionally. Two owners pressing send at the same
     moment, or one owner pressing twice, must not both get past this line. */
  db.update(campaigns).set({ status: "sending", updatedAt: nowSec() })
    .where(and(eq(campaigns.id, id), eq(campaigns.status, "draft"))).run();
  if (campaignById(id)?.status !== "sending") {
    return { ok: false, sent: 0, failed: 0, error: "Somebody else is already sending that one." };
  }

  const site = siteUrl();

  let sent = 0, failed = 0;
  for (const person of people) {
    const unsubscribe = `${site}/unsubscribe/${person.unsubscribeToken}`;
    const text = `${personalise(c.body, person)}\n\n—\nTo stop receiving these: ${unsubscribe}`;
    const res = await sendMail({
      to: [person.email],
      subject: c.subject,
      text,
      html: htmlFrom(personalise(c.body, person), unsubscribe),
      /* The header every mail client honours, and Gmail requires for bulk
         senders: an unsubscribe the recipient can press without opening the
         message. Cheaper for the restaurant than being marked as spam by
         somebody who could not find the link. */
      headers: {
        "List-Unsubscribe": `<${unsubscribe}>`,
        "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
      },
    });
    if (res.ok) {
      sent++;
      db.update(marketingContacts).set({ lastSentAt: nowSec() })
        .where(eq(marketingContacts.id, person.id)).run();
    } else {
      failed++;
      console.error(`[marketing] ${person.email}: ${res.detail ?? "refused"}`);
    }
  }

  db.update(campaigns).set({
    status: "sent",
    sentAt: nowSec(),
    sentByUserId,
    recipientCount: sent,
    failedCount: failed,
    updatedAt: nowSec(),
  }).where(eq(campaigns.id, id)).run();

  console.log(`[marketing] campaign ${id}: ${sent} sent, ${failed} refused`);
  return { ok: true, sent, failed };
}
