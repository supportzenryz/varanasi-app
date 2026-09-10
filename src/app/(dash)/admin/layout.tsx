import "../../globals.css";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession, can, type Session } from "@/lib/auth";
import { db } from "@/db";
import { branches } from "@/db/schema";
import { eq } from "drizzle-orm";
import { AdminNav } from "./AdminNav";

/** `ready: false` sections are shown but not linked, so the navigation shows the
 *  shape of the finished admin without handing anyone a dead link. */
const NAV = [
  { href: "/admin", label: "Overview", ability: null, ready: true },
  { href: "/admin/menu", label: "Menus & drinks", ability: "editMenu", ready: true },
  { href: "/admin/rooms", label: "Private dining", ability: "editRooms", ready: true },
  { href: "/admin/bookings", label: "Reservations", ability: "viewBookings", ready: true },
  { href: "/admin/dates", label: "Blocked dates", ability: "editBlockedDates", ready: true },
  { href: "/admin/vouchers", label: "Gift vouchers", ability: "redeemVoucher", ready: true },
  { href: "/admin/enquiries", label: "Enquiries", ability: "viewEnquiries", ready: true },
  { href: "/admin/marketing", label: "Weekly email", ability: "editMarketing", ready: true },
  { href: "/admin/gallery", label: "Gallery & tiles", ability: "editRooms", ready: true },
  { href: "/admin/staff", label: "Staff access", ability: "manageStaff", ready: true },
  { href: "/admin/settings", label: "Settings", ability: "editSettings", ready: true },
  { href: "/admin/logs", label: "Activity log", ability: "viewAuditLog", ready: true },
  { href: "/admin/erasure", label: "Erasure requests", ability: "erasePersonalData", ready: true },
  { href: "/admin/backups", label: "Backups", ability: "manageBackups", ready: true },
] as const;

function branchLabel(session: Session): string {
  if (session.role === "owner") return "Both branches";
  if (!session.branchId) return "No branch assigned";
  const b = db.select().from(branches).where(eq(branches.id, session.branchId)).get();
  return b?.city ?? "Unknown branch";
}

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session) redirect("/admin/login");

  const items = NAV
    .filter((i) => !i.ability || can(session, i.ability))
    .map((i) => ({ href: i.href, label: i.label, ready: i.ready }));

  return (
    <div className="dash min-h-dvh lg:grid lg:grid-cols-[15rem_1fr] bg-pale text-ink">
      {/* Both shapes of the navigation live in AdminNav: the rail on a laptop,
          a bar and a drawer on a phone. It used to be one row of markup doing
          both jobs, which on a 390px screen gave thirteen sections about ninety
          pixels of sideways-scrolling window between the logo and Sign out. */}
      <AdminNav items={items} name={session.name} role={session.role}
        branch={branchLabel(session)} />

      {/* `min-w-0` so a wide table inside a page cannot stretch this column
          and push the whole layout sideways — the grid track would otherwise
          grow to fit its content and take the page with it. */}
      <main className="min-w-0 p-5 sm:p-8 lg:p-10 max-w-6xl w-full">
        {session.mustChangePassword && (
          <div className="mb-8 border-l-2 border-gold bg-gold/10 px-4 py-3 text-sm">
            You&rsquo;re still using the password you were given.{" "}
            <Link href="/admin/password" className="font-semibold underline">Change it now</Link>.
          </div>
        )}
        {children}
      </main>
    </div>
  );
}
