import Link from "next/link";
import Image from "next/image";
import { notFound } from "next/navigation";
import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { branches, galleryImages, branchStats } from "@/db/schema";
import { requireAbility } from "@/lib/auth";
import { AdminNotice } from "@/components/AdminNotice";
import { ConfirmButton } from "@/components/ConfirmButton";
import {
  addImage, updateImage, deleteImage, moveImage, saveStat, addStat, deleteStat,
} from "./actions";

export const metadata = { title: "Gallery & venue tiles" };

const field = "w-full border border-[--line] bg-white px-3 py-2 text-sm outline-none focus:border-gold";
const label = "block text-xs font-semibold text-ink-3 mb-1";

export default async function GalleryAdmin({
  searchParams,
}: { searchParams: Promise<{ branch?: string; saved?: string; problem?: string }> }) {
  const session = await requireAbility("editRooms");
  const { branch: branchParam, saved, problem } = await searchParams;

  const all = db.select().from(branches).orderBy(asc(branches.sort)).all();
  const visible = session.role === "owner" ? all : all.filter((b) => b.id === session.branchId);
  const active = visible.find((b) => b.slug === branchParam) ?? visible[0];
  if (!active) notFound();

  const images = db.select().from(galleryImages)
    .where(eq(galleryImages.branchId, active.id)).orderBy(asc(galleryImages.sort)).all();
  const stats = db.select().from(branchStats)
    .where(eq(branchStats.branchId, active.id)).orderBy(asc(branchStats.sort)).all();

  return (
    <>
      <AdminNotice saved={saved} problem={problem} />
      <span className="accent text-xs text-gold-ink">Gallery &amp; venue tiles</span>
      <h1 className="text-3xl sm:text-4xl mt-3">{active.city}&rsquo;s photographs</h1>
      <p className="text-ink-3 mt-2 max-w-[62ch]">
        The gallery page and the numbers on the branch home page. Images come from the media library —
        paste the path, and the preview below tells you straight away whether it&rsquo;s the right one.
      </p>

      {visible.length > 1 && (
        <div className="flex gap-1 mt-7 border-b border-[--line]">
          {visible.map((b) => (
            <Link key={b.id} href={`/admin/gallery?branch=${b.slug}`}
              className={`px-4 py-2.5 text-sm border-b-2 -mb-px ${
                b.id === active.id ? "border-gold font-semibold" : "border-transparent text-ink-3 hover:text-ink"}`}>
              {b.city}
            </Link>
          ))}
        </div>
      )}

      {/* gallery */}
      <section className="mt-9">
        <h2 className="text-xl">Gallery ({images.filter((i) => i.isPublished).length} live)</h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {images.map((img, idx) => (
            <article key={img.id} className={`border border-[--line] ${img.isPublished ? "bg-white/50" : "bg-clay/5"}`}>
              <div className="relative aspect-[4/3] bg-ink/10">
                {img.src && <Image src={img.src} alt={img.alt ?? ""} fill sizes="320px" className="object-cover" />}
                {!img.isPublished && (
                  <span className="absolute top-2 left-2 accent text-[0.55rem] bg-ink text-pale px-2 py-1">
                    Hidden
                  </span>
                )}
                {img.isFeatured && (
                  <span className="absolute top-2 right-2 accent text-[0.55rem] bg-gold text-ink px-2 py-1">
                    Featured
                  </span>
                )}
              </div>
              <div className="p-3.5">
                <form action={updateImage} className="grid gap-2.5">
                  <input type="hidden" name="id" value={img.id} />
                  <div>
                    <label className={label} htmlFor={`alt${img.id}`}>Description (for screen readers)</label>
                    <input id={`alt${img.id}`} name="alt" defaultValue={img.alt ?? ""} className={field} />
                  </div>
                  <label className="flex items-center gap-2 text-xs">
                    <input type="checkbox" name="isPublished" defaultChecked={img.isPublished} /> Show on the website
                  </label>
                  <label className="flex items-center gap-2 text-xs">
                    <input type="checkbox" name="isFeatured" defaultChecked={img.isFeatured} /> Feature it
                  </label>
                  <button className="bg-ink text-pale px-3 py-2 text-xs font-semibold justify-self-start">Save</button>
                </form>
                <p className="text-[0.65rem] text-ink-3 mt-2.5 break-all">{img.src}</p>
                <div className="flex flex-wrap gap-1.5 mt-3 pt-3 border-t border-[--line]">
                  {idx > 0 && (
                    <form action={moveImage}>
                      <input type="hidden" name="id" value={img.id} /><input type="hidden" name="dir" value="up" />
                      <button className="text-[0.7rem] border border-[--line] px-2 py-1 hover:bg-pale">←</button>
                    </form>
                  )}
                  {idx < images.length - 1 && (
                    <form action={moveImage}>
                      <input type="hidden" name="id" value={img.id} /><input type="hidden" name="dir" value="down" />
                      <button className="text-[0.7rem] border border-[--line] px-2 py-1 hover:bg-pale">→</button>
                    </form>
                  )}
                  <form action={deleteImage} className="ml-auto">
                    <input type="hidden" name="id" value={img.id} />
                    <ConfirmButton ask="Remove this photograph from the gallery? This can't be undone."
                      className="text-[0.7rem] text-brick border border-brick/40 px-2 py-1 hover:bg-clay/10">
                      Remove
                    </ConfirmButton>
                  </form>
                </div>
              </div>
            </article>
          ))}
        </div>

        <details className="mt-6 border border-[--line] bg-white/50">
          <summary className="px-5 py-3.5 text-sm cursor-pointer text-gold-ink font-semibold hover:bg-white">
            Add a photograph
          </summary>
          <form action={addImage} className="px-5 pb-5 pt-1 grid gap-4 sm:grid-cols-2 bg-white">
            <input type="hidden" name="branchId" value={active.id} />
            <div className="sm:col-span-2">
              <label className={label} htmlFor="gsrc">Image path</label>
              <input id="gsrc" name="src" required placeholder={`/media/lib/${active.slug}/2024/08/photo.webp`}
                className={field} />
              <span className="block text-xs text-ink-3 mt-1">
                From the media library. Landscape shots at least 1400px wide look best.
              </span>
            </div>
            <div className="sm:col-span-2">
              <label className={label} htmlFor="galt">Description</label>
              <input id="galt" name="alt" placeholder="The main dining room at dusk" className={field} />
            </div>
            <button className="bg-ink text-pale px-5 py-2.5 text-sm font-semibold justify-self-start sm:col-span-2">
              Add photograph
            </button>
          </form>
        </details>
      </section>

      {/* stat tiles */}
      <section className="mt-14">
        <h2 className="text-xl">Venue tiles on the home page</h2>
        <p className="text-sm text-ink-3 mt-1.5 max-w-[62ch]">
          The numbers under the hero — &ldquo;8 Private Rooms&rdquo;, &ldquo;3 Cocktail Bars&rdquo;. Keep
          them true: the old site said six private rooms while the private dining page listed eight.
        </p>
        <div className="mt-5 grid gap-4">
          {stats.map((s) => (
            <form key={s.id} action={saveStat}
              className="border border-[--line] bg-white p-4 grid gap-4 sm:grid-cols-[6rem_1fr_1fr_1fr_auto] sm:items-end">
              <input type="hidden" name="id" value={s.id} />
              <div>
                <label className={label} htmlFor={`sv${s.id}`}>Number</label>
                <input id={`sv${s.id}`} name="value" defaultValue={s.value} className={field} required />
              </div>
              <div>
                <label className={label} htmlFor={`sl${s.id}`}>Label</label>
                <input id={`sl${s.id}`} name="label" defaultValue={s.label} className={field} required />
              </div>
              <div>
                <label className={label} htmlFor={`si${s.id}`}>Background image</label>
                <input id={`si${s.id}`} name="image" defaultValue={s.image ?? ""} className={field} />
              </div>
              <div>
                <label className={label} htmlFor={`sh${s.id}`}>Links to</label>
                <input id={`sh${s.id}`} name="href" defaultValue={s.href ?? ""}
                  placeholder={`/${active.slug}/private-dining-experiences`} className={field} />
              </div>
              <div className="flex gap-2">
                <button className="bg-ink text-pale px-4 py-2.5 text-sm font-semibold">Save</button>
              </div>
            </form>
          ))}
          {stats.map((s) => (
            <form key={`del${s.id}`} action={deleteStat} className="-mt-2">
              <input type="hidden" name="id" value={s.id} />
              <ConfirmButton ask={`Remove the "${s.value} ${s.label}" tile from the home page?`}
                className="text-[0.7rem] text-brick underline hover:text-brick/70">
                Remove &ldquo;{s.value} {s.label}&rdquo;
              </ConfirmButton>
            </form>
          ))}
        </div>

        <details className="mt-6 border border-[--line] bg-white/50">
          <summary className="px-5 py-3.5 text-sm cursor-pointer text-gold-ink font-semibold hover:bg-white">
            Add a tile
          </summary>
          <form action={addStat} className="px-5 pb-5 pt-1 grid gap-4 sm:grid-cols-2 bg-white">
            <input type="hidden" name="branchId" value={active.id} />
            <div>
              <label className={label} htmlFor="nsv">Number</label>
              <input id="nsv" name="value" required placeholder="3" className={field} />
            </div>
            <div>
              <label className={label} htmlFor="nsl">Label</label>
              <input id="nsl" name="label" required placeholder="Cocktail Bars" className={field} />
            </div>
            <div>
              <label className={label} htmlFor="nsi">Background image</label>
              <input id="nsi" name="image" className={field} />
            </div>
            <div>
              <label className={label} htmlFor="nsh">Links to</label>
              <input id="nsh" name="href" className={field} />
            </div>
            <button className="bg-ink text-pale px-5 py-2.5 text-sm font-semibold justify-self-start sm:col-span-2">
              Add tile
            </button>
          </form>
        </details>
      </section>
    </>
  );
}
