import Link from "next/link";
import { and, eq, gte, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { branches, enquiries, menuItems, menuCategories, privateRooms, vouchers, blockedDates, bookings } from "@/db/schema";
import { requirePasswordChanged } from "@/lib/auth";
import { formatPence } from "@/lib/money";

export const metadata = { title: "Overview" };

export default async function AdminHome() {
  const session = await requirePasswordChanged();
  const scoped = session.role !== "owner" && session.branchId != null;
  const branchIds = scoped
    ? [session.branchId!]
    : db.select({ id: branches.id }).from(branches).all().map((b) => b.id);

  const newEnquiries = db.select({ n: sql<number>`count(*)` }).from(enquiries)
    .where(and(eq(enquiries.status, "new"), inArray(enquiries.branchId, branchIds))).get()?.n ?? 0;

  const outstanding = db.select({ n: sql<number>`count(*)`, v: sql<number>`coalesce(sum(balance_pence),0)` })
    .from(vouchers).where(inArray(vouchers.status, ["active"])).get();

  const countItems = (kinds: ("food" | "set" | "drinks")[]) =>
    db.select({ n: sql<number>`count(*)` }).from(menuItems)
      .innerJoin(menuCategories, eq(menuCategories.id, menuItems.categoryId))
      .where(and(
        eq(menuItems.isPublished, true),
        inArray(menuCategories.branchId, branchIds),
        inArray(menuCategories.kind, kinds),
      )).get()?.n ?? 0;

  const published = countItems(["food", "set"]);
  const publishedDrinks = countItems(["drinks"]);

  const liveRooms = db.select({ n: sql<number>`count(*)` }).from(privateRooms)
    .where(and(eq(privateRooms.isPublished, true), inArray(privateRooms.branchId, branchIds))).get()?.n ?? 0;

  const unpublishedRooms = db.select({ id: privateRooms.id, name: privateRooms.name, branchId: privateRooms.branchId })
    .from(privateRooms).where(and(eq(privateRooms.isPublished, false), inArray(privateRooms.branchId, branchIds))).all();

  const today = new Date().toISOString().slice(0, 10);
  const upcomingBlocks = db.select({ n: sql<number>`count(*)` }).from(blockedDates)
    .where(and(gte(blockedDates.date, today), inArray(blockedDates.branchId, branchIds))).get()?.n ?? 0;

  const bookingsToday = db.select({ n: sql<number>`count(*)` }).from(bookings)
    .where(and(
      eq(bookings.date, today),
      inArray(bookings.branchId, branchIds),
      inArray(bookings.status, ["held", "confirmed", "seated"]),
    )).get()?.n ?? 0;

  const stats = [
    { label: "Bookings today", value: String(bookingsToday), href: "/admin/bookings" },
    { label: "Enquiries waiting", value: String(newEnquiries), href: "/admin/enquiries" },
    { label: "Vouchers outstanding", value: formatPence(outstanding?.v ?? 0) || "£0", sub: `${outstanding?.n ?? 0} live`, href: "/admin/vouchers" },
    { label: "Dishes published", value: String(published), href: "/admin/menu" },
    { label: "Drinks published", value: String(publishedDrinks), href: "/admin/menu?kind=drinks" },
    { label: "Private rooms live", value: String(liveRooms), href: "/admin/rooms" },
    { label: "Dates blocked ahead", value: String(upcomingBlocks), href: "/admin/dates" },
  ];

  return (
    <>
      <span className="accent text-xs text-gold-ink">Overview</span>
      <h1 className="text-3xl sm:text-4xl mt-3">Good to see you, {session.name.split(" ")[0]}</h1>
      <p className="text-ink-3 mt-2 max-w-[52ch]">
        {session.role === "owner"
          ? "You're seeing both branches. Managers only see their own."
          : "You're seeing your own branch."}
      </p>

      <div className="mt-9 grid gap-px bg-[--line] sm:grid-cols-2 lg:grid-cols-4 border border-[--line]">
        {stats.map((s) => {
          const inner = (
            <>
              <span className="block text-3xl tnum display">{s.value}</span>
              <span className="block text-sm text-ink-3 mt-1.5">{s.label}</span>
              {s.sub && <span className="block text-xs text-ink-3/70 mt-0.5">{s.sub}</span>}
            </>
          );
          return s.href ? (
            <Link key={s.label} href={s.href} className="bg-pale hover:bg-white transition-colors p-5">{inner}</Link>
          ) : (
            <div key={s.label} className="bg-pale p-5">{inner}</div>
          );
        })}
      </div>

      {unpublishedRooms.length > 0 && (
        <section className="mt-10 border-l-2 border-clay bg-clay/8 px-5 py-4">
          <h2 className="text-lg">Private dining needs a look</h2>
          <p className="text-sm text-ink-3 mt-1.5 max-w-[62ch]">
            {unpublishedRooms.length} room{unpublishedRooms.length > 1 ? "s are" : " is"} hidden from the website.
            Check the details are right, then switch {unpublishedRooms.length > 1 ? "them" : "it"} on.
          </p>
          <Link href="/admin/rooms" className="text-sm mt-3 inline-block font-semibold underline hover:text-gold-ink">
            Open private dining
          </Link>
        </section>
      )}

      <section className="mt-12">
        <h2 className="text-xl">Common jobs</h2>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {[
            { t: "Change a price", d: "Menus & drinks, pick a branch, edit the dish. It goes live straight away.", h: "/admin/menu" },
            { t: "Edit the drinks list", d: "Wines and spirits with their measures and bottle prices.", h: "/admin/menu?kind=drinks" },
            { t: "Update a private room", d: "Capacity, deposit, hire charge, photograph and description.", h: "/admin/rooms" },
            { t: "Log a phone booking", d: "Add a reservation taken by phone straight into today's list.", h: "/admin/bookings" },
            { t: "Block out a date", d: "Close a branch, or one room, for a private event or holiday.", h: "/admin/dates" },
            { t: "Answer an enquiry", d: "Everything sent through the website's forms, with notes and statuses.", h: "/admin/enquiries" },
            { t: "Redeem a gift voucher", d: "Look one up by code and take the amount off the bill.", h: "/admin/vouchers" },
            { t: "Swap a photograph", d: "Gallery images and the venue tiles on the home page.", h: "/admin/gallery" },
            { t: "Hide a dish", d: "Take something off the website without deleting it.", h: "/admin/menu" },
            { t: "Reorder a section", d: "Move dishes up or down within a menu section.", h: "/admin/menu" },
            { t: "Rename a section", d: "Change a menu heading or the note beneath it.", h: "/admin/menu" },
          ].map((c) => (
            <Link key={c.t} href={c.h} className="border border-[--line] bg-white/60 hover:bg-white p-4">
              <span className="block font-semibold text-sm">{c.t}</span>
              <span className="block text-sm text-ink-3 mt-1">{c.d}</span>
            </Link>
          ))}
        </div>
      </section>
    </>
  );
}
