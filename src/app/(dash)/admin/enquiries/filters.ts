import { and, desc, eq, gte, inArray, like, or, sql, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { branches, enquiries } from "@/db/schema";
import { visibleBranchIds, type Session } from "@/lib/auth";
import type { EnquiryType } from "@/lib/enquiry";

/**
 * One definition of "which enquiries am I looking at", shared by the screen and
 * the CSV export. They must not drift: an export that quietly returns a
 * different set from the list above it is worse than no export at all.
 */

export type EnquiryQuery = {
  /** 1-based; the list is paged rather than silently truncated */
  page?: string;
  status?: string;
  type?: string;
  branch?: string;
  /** today | week | month | all */
  range?: string;
  /** free text, matched against name, email and phone */
  q?: string;
  saved?: string;
  problem?: string;
};

export const RANGES = [
  { key: "today", label: "Today" },
  { key: "week", label: "This week" },
  { key: "month", label: "This month" },
  { key: "all", label: "All time" },
] as const;

const STATUSES = ["new", "contacted", "confirmed", "closed"] as const;
const TYPES = ["booking", "private_room", "corporate", "catering", "contact", "franchise"] as const;

/** createdAt is a unix second. Ranges are calendar-relative in local server
 *  time, not rolling 24/168-hour windows — "today" has to mean today's date to
 *  someone reading the screen, or the count won't match what they can see. */
function since(range: string | undefined): number | null {
  const d = new Date();
  switch (range) {
    case "today":
      d.setHours(0, 0, 0, 0);
      return Math.floor(d.getTime() / 1000);
    case "week": {
      // Week starts Monday, as a UK rota does.
      const dow = (d.getDay() + 6) % 7;
      d.setDate(d.getDate() - dow);
      d.setHours(0, 0, 0, 0);
      return Math.floor(d.getTime() / 1000);
    }
    case "month":
      d.setDate(1);
      d.setHours(0, 0, 0, 0);
      return Math.floor(d.getTime() / 1000);
    default:
      return null;
  }
}

/** Digits only, so "0121 633 3700", "0121-633-3700" and "01216333700" all find
 *  the same row. Phone numbers are stored as typed, so the comparison has to
 *  strip punctuation from both sides. */
function digits(s: string): string {
  return s.replace(/\D+/g, "");
}

export function buildEnquiryWhere(session: Session, params: EnquiryQuery): SQL {
  const all = db.select().from(branches).all();
  // One definition of what this account may see, shared with every other
  // screen — see lib/auth. A non-owner with no branch assigned matches nothing.
  const branchIds = visibleBranchIds(session);

  const status = params.status ?? "open";
  const clauses: (SQL | undefined)[] = [
    // Franchise enquiries carry no branch, so only an owner should see them —
    // a manager scoped to a branch must not.
    session.role === "owner"
      ? sql`1 = 1`
      : inArray(enquiries.branchId, branchIds.length ? branchIds : [-1]),

    status === "open"
      ? inArray(enquiries.status, ["new", "contacted"])
      : status === "all"
        ? sql`1 = 1`
        : STATUSES.includes(status as (typeof STATUSES)[number])
          ? eq(enquiries.status, status as (typeof STATUSES)[number])
          : sql`1 = 1`,

    params.branch
      ? eq(enquiries.branchId, all.find((b) => b.slug === params.branch)?.id ?? -1)
      : sql`1 = 1`,

    params.type && TYPES.includes(params.type as EnquiryType)
      ? eq(enquiries.type, params.type as EnquiryType)
      : sql`1 = 1`,
  ];

  const from = since(params.range);
  if (from != null) clauses.push(gte(enquiries.createdAt, from));

  const term = params.q?.trim();
  if (term) {
    const text = `%${term.toLowerCase()}%`;
    const parts: (SQL | undefined)[] = [
      like(sql`lower(${enquiries.name})`, text),
      like(sql`lower(${enquiries.email})`, text),
      like(sql`lower(${enquiries.company})`, text),
    ];
    // A search that looks like a phone number also matches the phone column
    // with all punctuation removed from both sides.
    const d = digits(term);
    if (d.length >= 3) {
      parts.push(
        like(
          sql`replace(replace(replace(replace(coalesce(${enquiries.phone},''),' ',''),'-',''),'(',''),')','')`,
          `%${d}%`,
        ),
      );
    }
    clauses.push(or(...parts));
  }

  return and(...clauses) as SQL;
}

export function selectEnquiries(session: Session, params: EnquiryQuery, limit = 200, offset = 0) {
  return db
    .select()
    .from(enquiries)
    .where(buildEnquiryWhere(session, params))
    .orderBy(desc(enquiries.createdAt))
    .limit(limit)
    .offset(offset)
    .all();
}
