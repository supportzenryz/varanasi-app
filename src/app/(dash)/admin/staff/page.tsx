import { asc } from "drizzle-orm";
import { db } from "@/db";
import { branches, users } from "@/db/schema";
import { requireAbility, CAN } from "@/lib/auth";
import { STARTING_STAFF_PASSWORD } from "@/lib/staff";
import { addStaff, updateStaff, toggleStaff, resetStaffPassword } from "./actions";

export const metadata = { title: "Staff access" };

const field = "w-full border border-[--line] bg-white px-3 py-2 text-sm outline-none focus:border-gold";
const label = "block text-xs font-semibold text-ink-3 mb-1";

const ROLE_NOTE: Record<string, string> = {
  owner: "Everything, both branches, including staff and settings",
  manager: "Their own branch: menus, rooms, bookings, dates, vouchers, enquiries",
  staff: "Their own branch: look up and redeem vouchers, read bookings and enquiries",
};

export default async function StaffAdmin() {
  const session = await requireAbility("manageStaff");
  const all = db.select().from(branches).orderBy(asc(branches.sort)).all();
  const cityOf = new Map(all.map((b) => [b.id, b.city]));
  const rows = db.select().from(users).orderBy(asc(users.name)).all();

  return (
    <>
      <span className="accent text-xs text-gold-ink">Staff access</span>
      <h1 className="text-3xl sm:text-4xl mt-3">Who can get in</h1>
      <p className="text-ink-3 mt-2 max-w-[62ch]">
        Accounts start on a shared password and must change it before they can do anything — so handing
        someone their login doesn&rsquo;t mean knowing their password afterwards.
      </p>

      {/* what each role can do, so this isn't guesswork */}
      <div className="mt-8 grid gap-px bg-[--line] sm:grid-cols-3 border border-[--line]">
        {(["owner", "manager", "staff"] as const).map((r) => (
          <div key={r} className="bg-pale p-5">
            <span className="accent text-[0.6rem] text-gold-ink capitalize">{r}</span>
            <p className="text-sm mt-2 text-ink-3">{ROLE_NOTE[r]}</p>
            <p className="text-xs text-ink-3/70 mt-2 tnum">
              {Object.entries(CAN).filter(([, roles]) => (roles as readonly string[]).includes(r)).length} permissions
            </p>
          </div>
        ))}
      </div>

      <div className="mt-9 grid gap-4">
        {rows.map((u) => (
          <section key={u.id} className={`border border-[--line] ${u.isActive ? "bg-white/50" : "bg-clay/5"}`}>
            <details>
              <summary className="px-5 py-4 cursor-pointer flex flex-wrap items-center gap-4 hover:bg-white">
                <span className="flex-1 min-w-48">
                  <span className="block">
                    {u.name}
                    {u.id === session.userId && <span className="text-xs text-ink-3"> · you</span>}
                  </span>
                  <span className="block text-xs text-ink-3 mt-0.5">{u.email}</span>
                </span>
                <span className="text-xs capitalize text-ink-3">
                  {u.role} · {u.role === "owner" ? "Both branches" : u.branchId ? cityOf.get(u.branchId) : "No branch"}
                </span>
                {!u.isActive && <span className="accent text-[0.6rem] text-clay">Deactivated</span>}
                {u.mustChangePassword && u.isActive && (
                  <span className="accent text-[0.6rem] text-gold-ink">Password not set</span>
                )}
              </summary>

              <div className="px-5 pb-5 pt-1 bg-white">
                <form action={updateStaff} className="grid gap-4 sm:grid-cols-3">
                  <input type="hidden" name="id" value={u.id} />
                  <div>
                    <label className={label} htmlFor={`n${u.id}`}>Name</label>
                    <input id={`n${u.id}`} name="name" defaultValue={u.name} className={field} required />
                  </div>
                  <div>
                    <label className={label} htmlFor={`r${u.id}`}>Role</label>
                    <select id={`r${u.id}`} name="role" defaultValue={u.role} className={field}>
                      <option value="staff">Staff</option>
                      <option value="manager">Manager</option>
                      <option value="owner">Owner</option>
                    </select>
                  </div>
                  <div>
                    <label className={label} htmlFor={`b${u.id}`}>Branch</label>
                    <select id={`b${u.id}`} name="branchId" defaultValue={u.branchId ?? ""} className={field}>
                      <option value="">Both / none</option>
                      {all.map((b) => <option key={b.id} value={b.id}>{b.city}</option>)}
                    </select>
                    <span className="block text-xs text-ink-3 mt-1">Owners always see both.</span>
                  </div>
                  <button className="bg-ink text-pale px-5 py-2.5 text-sm font-semibold justify-self-start sm:col-span-3">
                    Save changes
                  </button>
                </form>

                <div className="flex flex-wrap gap-2 mt-5 pt-4 border-t border-[--line]">
                  <form action={resetStaffPassword}>
                    <input type="hidden" name="id" value={u.id} />
                    <button className="text-xs border border-[--line] px-3 py-1.5 hover:bg-pale">
                      Reset password
                    </button>
                  </form>
                  {u.id !== session.userId && (
                    <form action={toggleStaff}>
                      <input type="hidden" name="id" value={u.id} />
                      <button className="text-xs border border-[--line] px-3 py-1.5 hover:bg-pale">
                        {u.isActive ? "Deactivate" : "Reactivate"}
                      </button>
                    </form>
                  )}
                  <p className="text-xs text-ink-3 basis-full mt-1">
                    Resetting puts them back on <code className="tnum">{STARTING_STAFF_PASSWORD}</code> and
                    forces a change at next login. Accounts are deactivated, never deleted, so the audit
                    trail stays intact.
                  </p>
                </div>

                {u.lastLoginAt && (
                  <p className="text-xs text-ink-3 mt-3">
                    Last signed in {new Date(u.lastLoginAt * 1000).toLocaleString("en-GB")}
                  </p>
                )}
              </div>
            </details>
          </section>
        ))}
      </div>

      <details className="mt-8 border border-[--line] bg-white/50">
        <summary className="px-5 py-3.5 text-sm cursor-pointer text-gold-ink font-semibold hover:bg-white">
          Add someone
        </summary>
        <form action={addStaff} className="px-5 pb-5 pt-1 grid gap-4 sm:grid-cols-2 bg-white">
          <div>
            <label className={label} htmlFor="an">Name</label>
            <input id="an" name="name" className={field} required />
          </div>
          <div>
            <label className={label} htmlFor="ae">Email</label>
            <input id="ae" name="email" type="email" className={field} required />
          </div>
          <div>
            <label className={label} htmlFor="ar">Role</label>
            <select id="ar" name="role" defaultValue="staff" className={field}>
              <option value="staff">Staff</option>
              <option value="manager">Manager</option>
              <option value="owner">Owner</option>
            </select>
          </div>
          <div>
            <label className={label} htmlFor="ab">Branch</label>
            <select id="ab" name="branchId" defaultValue="" className={field}>
              <option value="">Both / none</option>
              {all.map((b) => <option key={b.id} value={b.id}>{b.city}</option>)}
            </select>
          </div>
          <p className="text-xs text-ink-3 sm:col-span-2">
            They start on <code className="tnum">{STARTING_STAFF_PASSWORD}</code> and must change it
            before they can reach anything else. Tell them in person, not by email.
          </p>
          <button className="bg-ink text-pale px-5 py-2.5 text-sm font-semibold justify-self-start sm:col-span-2">
            Add account
          </button>
        </form>
      </details>
    </>
  );
}
