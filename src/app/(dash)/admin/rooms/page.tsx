import Link from "next/link";
import Image from "next/image";
import { notFound } from "next/navigation";
import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { branches, privateRooms } from "@/db/schema";
import { requireAbility } from "@/lib/auth";
import { formatPence } from "@/lib/money";
import { saveRoom, addRoom, toggleRoom, deleteRoom, moveRoom } from "./actions";

export const metadata = { title: "Private dining" };

const field = "w-full border border-[--line] bg-white px-3 py-2 text-sm outline-none focus:border-gold";
const label = "block text-xs font-semibold text-ink-3 mb-1";
const poundValue = (p: number | null) => (p == null ? "" : (p / 100).toFixed(2).replace(/\.00$/, ""));

function idealForText(json: string | null): string {
  if (!json) return "";
  try {
    const v = JSON.parse(json);
    return Array.isArray(v) ? v.join(", ") : "";
  } catch {
    return "";
  }
}

export default async function RoomsAdmin({ searchParams }: { searchParams: Promise<{ branch?: string }> }) {
  const session = await requireAbility("editRooms");
  const { branch: branchParam } = await searchParams;

  const all = db.select().from(branches).orderBy(asc(branches.sort)).all();
  const visible = session.role === "owner" ? all : all.filter((b) => b.id === session.branchId);
  const active = visible.find((b) => b.slug === branchParam) ?? visible[0];
  if (!active) notFound();

  const rooms = db.select().from(privateRooms)
    .where(eq(privateRooms.branchId, active.id)).orderBy(asc(privateRooms.sort)).all();

  return (
    <>
      <span className="accent text-xs text-gold-ink">Private dining</span>
      <h1 className="text-3xl sm:text-4xl mt-3">{active.city}&rsquo;s private rooms</h1>
      <p className="text-ink-3 mt-2 max-w-[62ch]">
        Capacities, deposits and hire charges appear on the private dining page exactly as you enter them here.
        Hidden rooms stay off the website entirely.
      </p>

      {visible.length > 1 && (
        <div className="flex gap-1 mt-7 border-b border-[--line]">
          {visible.map((b) => (
            <Link key={b.id} href={`/admin/rooms?branch=${b.slug}`}
              className={`px-4 py-2.5 text-sm border-b-2 -mb-px ${
                b.id === active.id ? "border-gold font-semibold" : "border-transparent text-ink-3 hover:text-ink"}`}>
              {b.city}
            </Link>
          ))}
        </div>
      )}

      <div className="mt-8 grid gap-6">
        {rooms.map((room, idx) => (
          <section key={room.id} className={`border border-[--line] ${room.isPublished ? "bg-white/50" : "bg-clay/5"}`}>
            <details>
              <summary className="px-5 py-4 cursor-pointer flex flex-wrap items-center gap-4 hover:bg-white">
                <span className="relative w-20 h-14 shrink-0 bg-ink/10 overflow-hidden">
                  {room.image && <Image src={room.image} alt="" fill sizes="80px" className="object-cover" />}
                </span>
                <span className="flex-1 min-w-40">
                  <span className="block text-lg">{room.name}</span>
                  <span className="block text-xs text-ink-3 mt-0.5 tnum">
                    {room.capacityMax ? `Up to ${room.capacityMax} guests` : "Capacity not set"}
                    {room.hireChargePence != null && ` · hire ${formatPence(room.hireChargePence)}`}
                    {room.depositPerPersonPence != null && ` · deposit ${formatPence(room.depositPerPersonPence)} pp`}
                  </span>
                </span>
                {!room.isPublished && <span className="accent text-[0.6rem] text-clay">Hidden</span>}
              </summary>

              <div className="px-5 pb-5 pt-1 bg-white">
                <form action={saveRoom} className="grid gap-4 sm:grid-cols-2">
                  <input type="hidden" name="id" value={room.id} />

                  <div className="sm:col-span-2"><label className={label} htmlFor={`n${room.id}`}>Room name</label>
                    <input id={`n${room.id}`} name="name" defaultValue={room.name} className={field} required /></div>

                  <div><label className={label} htmlFor={`h${room.id}`}>Headline</label>
                    <input id={`h${room.id}`} name="headline" defaultValue={room.headline ?? ""}
                      placeholder="A Formal, Private Business Environment" className={field} /></div>
                  <div><label className={label} htmlFor={`t${room.id}`}>Short line for cards</label>
                    <input id={`t${room.id}`} name="tagline" defaultValue={room.tagline ?? ""} className={field} /></div>

                  <div className="sm:col-span-2"><label className={label} htmlFor={`d${room.id}`}>Description</label>
                    <textarea id={`d${room.id}`} name="description" rows={4}
                      defaultValue={room.description ?? ""} className={field} /></div>

                  <div className="grid grid-cols-2 gap-4">
                    <div><label className={label} htmlFor={`cmin${room.id}`}>Capacity from</label>
                      <input id={`cmin${room.id}`} name="capacityMin" inputMode="numeric"
                        defaultValue={room.capacityMin ?? ""} className={field} /></div>
                    <div><label className={label} htmlFor={`cmax${room.id}`}>Capacity up to</label>
                      <input id={`cmax${room.id}`} name="capacityMax" inputMode="numeric"
                        defaultValue={room.capacityMax ?? ""} className={field} /></div>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div><label className={label} htmlFor={`dep${room.id}`}>Deposit per person</label>
                      <input id={`dep${room.id}`} name="deposit" inputMode="decimal"
                        defaultValue={poundValue(room.depositPerPersonPence)} className={field} /></div>
                    <div><label className={label} htmlFor={`hire${room.id}`}>Hire charge</label>
                      <input id={`hire${room.id}`} name="hireCharge" inputMode="decimal"
                        defaultValue={poundValue(room.hireChargePence)} className={field} /></div>
                  </div>

                  <div><label className={label} htmlFor={`sm${room.id}`}>Set menu note</label>
                    <input id={`sm${room.id}`} name="setMenuNote" defaultValue={room.setMenuNote ?? ""}
                      placeholder="Dawat Set Menu at £65.00 per person" className={field} /></div>
                  <div><label className={label} htmlFor={`ex${room.id}`}>Exclusivity note</label>
                    <input id={`ex${room.id}`} name="exclusivityNote" defaultValue={room.exclusivityNote ?? ""}
                      placeholder="Charges apply" className={field} /></div>

                  <div className="sm:col-span-2"><label className={label} htmlFor={`if${room.id}`}>Ideal for</label>
                    <input id={`if${room.id}`} name="idealFor" defaultValue={idealForText(room.idealFor)}
                      placeholder="Family Gatherings, Milestone Birthdays, Anniversaries" className={field} />
                    <span className="block text-xs text-ink-3 mt-1">Separate each occasion with a comma.</span></div>

                  <div className="sm:col-span-2"><label className={label} htmlFor={`img${room.id}`}>Photograph</label>
                    <input id={`img${room.id}`} name="image" defaultValue={room.image ?? ""} className={field} />
                    <span className="block text-xs text-ink-3 mt-1">
                      Path inside the media library, e.g. /media/lib/{active.slug}/2024/07/room.jpg
                    </span></div>

                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" name="isPublished" defaultChecked={room.isPublished} /> Show on the website
                  </label>

                  <button className="bg-ink text-pale px-5 py-2.5 text-sm font-semibold justify-self-start sm:col-span-2">
                    Save changes
                  </button>
                </form>

                <div className="flex flex-wrap gap-2 mt-4 pt-4 border-t border-[--line]">
                  <form action={toggleRoom}><input type="hidden" name="id" value={room.id} />
                    <button className="text-xs border border-[--line] px-3 py-1.5 hover:bg-pale">
                      {room.isPublished ? "Hide from website" : "Show on website"}</button></form>
                  {idx > 0 && (
                    <form action={moveRoom}><input type="hidden" name="id" value={room.id} />
                      <input type="hidden" name="dir" value="up" />
                      <button className="text-xs border border-[--line] px-3 py-1.5 hover:bg-pale">Move up</button></form>
                  )}
                  {idx < rooms.length - 1 && (
                    <form action={moveRoom}><input type="hidden" name="id" value={room.id} />
                      <input type="hidden" name="dir" value="down" />
                      <button className="text-xs border border-[--line] px-3 py-1.5 hover:bg-pale">Move down</button></form>
                  )}
                  <form action={deleteRoom} className="ml-auto"><input type="hidden" name="id" value={room.id} />
                    <button className="text-xs text-brick border border-brick/40 px-3 py-1.5 hover:bg-clay/10">
                      Delete this room</button></form>
                </div>
              </div>
            </details>
          </section>
        ))}
      </div>

      <details className="mt-8 border border-[--line] bg-white/50">
        <summary className="px-5 py-3.5 text-sm cursor-pointer text-gold-ink font-semibold hover:bg-white">
          Add a private room
        </summary>
        <form action={addRoom} className="px-5 pb-5 pt-1 grid gap-4 sm:grid-cols-2 bg-white">
          <input type="hidden" name="branchId" value={active.id} />
          <div><label className={label} htmlFor="arn">Room name</label>
            <input id="arn" name="name" className={field} required /></div>
          <div><label className={label} htmlFor="arc">Capacity up to</label>
            <input id="arc" name="capacityMax" inputMode="numeric" className={field} /></div>
          <div className="sm:col-span-2"><label className={label} htmlFor="art">Short line for cards</label>
            <input id="art" name="tagline" className={field} /></div>
          <div className="sm:col-span-2"><label className={label} htmlFor="ari">Photograph</label>
            <input id="ari" name="image" placeholder={`/media/lib/${active.slug}/...`} className={field} /></div>
          <p className="text-xs text-ink-3 sm:col-span-2">
            New rooms start hidden — fill in the rest of the details, then switch them on.
          </p>
          <button className="bg-ink text-pale px-5 py-2.5 text-sm font-semibold justify-self-start sm:col-span-2">
            Add room
          </button>
        </form>
      </details>
    </>
  );
}
