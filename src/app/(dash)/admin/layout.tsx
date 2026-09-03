import "../../globals.css";
import Image from "next/image";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession, can, type Session } from "@/lib/auth";
import { db } from "@/db";
import { branches } from "@/db/schema";
import { eq } from "drizzle-orm";
import { logoutAction } from "./actions";

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
  { href: "/admin/gallery", label: "Gallery & tiles", ability: "editRooms", ready: true },
  { href: "/admin/staff", label: "Staff access", ability: "manageStaff", ready: true },
  { href: "/admin/settings", label: "Settings", ability: "editSettings", ready: true },
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

  return (
    <div className="dash min-h-dvh lg:grid lg:grid-cols-[15rem_1fr] bg-pale text-ink">
      <aside className="bg-ink text-pale lg:min-h-dvh flex lg:flex-col gap-6 lg:gap-0 items-center lg:items-stretch px-5 py-4 lg:py-7 lg:px-0 overflow-x-auto">
        {/* The sidebar is ink, so the white mark is the right variant here.
            Narrow screens collapse the rail to a scrolling strip, where the
            mark shrinks and the "Admin" caption is dropped. */}
        <Link href="/admin" className="shrink-0 lg:px-6 lg:mb-7 flex lg:flex-col lg:items-start items-center gap-2">
          <Image src="/brand/logo.png" alt="Varanasi" width={520} height={104}
            className="h-8 lg:h-10 w-auto" priority />
          <span className="accent text-gold/70 hidden lg:inline">Admin</span>
        </Link>

        <nav className="flex lg:flex-col gap-1 lg:gap-0 flex-1">
          {NAV.filter((i) => !i.ability || can(session, i.ability)).map((item) =>
            item.ready ? (
              <Link key={item.href} href={item.href}
                className="whitespace-nowrap text-sm px-3 lg:px-6 py-2 lg:py-2.5 text-pale/70 hover:text-pale hover:bg-white/5 border-l-2 border-transparent hover:border-gold">
                {item.label}
              </Link>
            ) : (
              <span key={item.href} aria-disabled="true"
                className="whitespace-nowrap text-sm px-3 lg:px-6 py-2 lg:py-2.5 text-pale/30 border-l-2 border-transparent flex items-baseline gap-2">
                {item.label}
                <span className="text-[0.58rem] uppercase tracking-widest text-gold/50">Soon</span>
              </span>
            )
          )}
        </nav>

        <div className="lg:px-6 lg:pt-6 lg:border-t border-white/10 shrink-0">
          <p className="text-sm font-semibold leading-tight">{session.name}</p>
          <p className="text-xs text-pale/50 mt-0.5 capitalize">{session.role} · {branchLabel(session)}</p>
          <form action={logoutAction}>
            <button className="mt-3 text-xs text-gold hover:underline">Sign out</button>
          </form>
        </div>
      </aside>

      <main className="p-6 sm:p-10 max-w-6xl w-full">
        {session.mustChangePassword && (
          <div className="mb-8 border-l-2 border-gold bg-gold/10 px-4 py-3 text-sm">
            You're still using the password you were given.{" "}
            <Link href="/admin/password" className="font-semibold underline">Change it now</Link>.
          </div>
        )}
        {children}
      </main>
    </div>
  );
}
