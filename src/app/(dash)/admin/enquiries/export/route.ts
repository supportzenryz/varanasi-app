import { eq } from "drizzle-orm";
import { db } from "@/db";
import { auditLog, branches, privateRooms, users } from "@/db/schema";
import { requireAbility } from "@/lib/auth";
import { TYPE_LABEL, type EnquiryType } from "@/lib/enquiry";
import { selectEnquiries, type EnquiryQuery } from "../filters";

/**
 * The enquiries list as a CSV, using exactly the filters showing on screen.
 *
 * Two things matter here beyond writing the rows out.
 *
 * Formula injection: every cell is user-submitted text, and Excel and Sheets
 * treat a leading =, +, - or @ as a formula. A message body of
 * `=HYPERLINK(...)` would execute when a manager opens the file. Any such cell
 * is prefixed with an apostrophe, which both applications read as "this is
 * text" and hide.
 *
 * Audit: exporting a file of names, emails and phone numbers is a bulk export
 * of personal data. Under UK GDPR that is worth a record, so who exported what
 * and when is written to the audit log — the same table the rest of the admin
 * uses.
 */

const COLUMNS = [
  "Reference", "Received", "Status", "Type", "Branch",
  "Name", "Email", "Phone", "Company",
  "Guests", "Preferred date", "Preferred time", "Occasion", "Room", "Dietary",
  "Message", "Marketing consent", "Terms accepted", "Handled by", "Internal note",
] as const;

/** RFC 4180 quoting, plus the leading-formula guard. */
function cell(value: unknown): string {
  if (value == null) return "";
  let s = String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}

const stamp = (unix: number | null) =>
  unix ? new Date(unix * 1000).toISOString().replace("T", " ").slice(0, 19) : "";

export async function GET(request: Request) {
  const session = await requireAbility("viewEnquiries");
  const sp = new URL(request.url).searchParams;

  const params: EnquiryQuery = {
    status: sp.get("status") ?? undefined,
    type: sp.get("type") ?? undefined,
    branch: sp.get("branch") ?? undefined,
    range: sp.get("range") ?? undefined,
    q: sp.get("q") ?? undefined,
  };

  // No limit worth speaking of on an export — a manager asking for the year
  // should get the year.
  const rows = selectEnquiries(session, params, 10_000);

  const city = new Map(db.select().from(branches).all().map((b) => [b.id, b.city]));
  const staff = new Map(db.select({ id: users.id, name: users.name }).from(users).all().map((u) => [u.id, u.name]));
  const room = new Map(
    db.select({ id: privateRooms.id, name: privateRooms.name }).from(privateRooms).all().map((r) => [r.id, r.name]),
  );

  const lines = [
    COLUMNS.map(cell).join(","),
    ...rows.map((e) =>
      [
        `ENQ-${e.id}`,
        stamp(e.createdAt),
        e.status,
        TYPE_LABEL[e.type as EnquiryType] ?? e.type,
        e.branchId ? city.get(e.branchId) ?? "" : "Not branch-specific",
        e.name,
        e.email,
        e.phone,
        e.company,
        e.partySize,
        e.requestedDate,
        e.requestedTime,
        e.occasion,
        e.roomId ? room.get(e.roomId) ?? "" : "",
        e.dietary,
        e.message,
        e.marketingConsent ? "yes" : "no",
        stamp(e.termsAcceptedAt),
        e.handledByUserId ? staff.get(e.handledByUserId) ?? "" : "",
        e.internalNote,
      ]
        .map(cell)
        .join(","),
    ),
  ];

  const describe = [
    params.status && params.status !== "open" ? `status=${params.status}` : null,
    params.type ? `type=${params.type}` : null,
    params.branch ? `branch=${params.branch}` : null,
    params.range && params.range !== "all" ? `range=${params.range}` : null,
    params.q ? `search="${params.q}"` : null,
  ].filter(Boolean).join(" ");

  db.insert(auditLog).values({
    userId: session.userId,
    action: "enquiry.export",
    entity: "enquiry",
    entityId: "-",
    detail: `${rows.length} row(s)${describe ? ` — ${describe}` : ""}`,
  }).run();

  const today = new Date().toISOString().slice(0, 10);
  const scope = params.branch ? `-${params.branch}` : "";

  // A BOM so Excel on Windows reads the £ signs and accented names as UTF-8
  // rather than mojibake. Without it "Café" arrives as "CafÃ©".
  return new Response("﻿" + lines.join("\r\n") + "\r\n", {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="varanasi-enquiries${scope}-${today}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
