import Image from "next/image";
import { formatPence, DIETARY_LABELS } from "@/lib/money";

export type MenuItemRow = {
  id: number;
  name: string;
  description: string | null;
  pricePence: number | null;
  measure: string | null;
  pricePence2: number | null;
  measure2: string | null;
  meta: string | null;
  dietary: string | null;
  isSignature: boolean;
};
export type MenuCategoryRow = {
  id: number;
  name: string;
  slug: string;
  note: string | null;
  image: string | null;
  pricePence: number | null;
};

/** One price column, with its measure above it as the printed menu sets them. */
function Price({ measure, pence }: { measure: string | null; pence: number | null }) {
  if (pence == null) return null;
  return (
    <span className="shrink-0 text-right whitespace-nowrap">
      {measure && <span className="accent text-[0.5rem] text-pale/45 mr-1.5 align-middle">{measure}</span>}
      <span className="tnum align-middle text-gold">{formatPence(pence)}</span>
    </span>
  );
}

export function MenuSections({
  categories, itemsByCategory,
}: {
  categories: MenuCategoryRow[];
  itemsByCategory: Map<number, MenuItemRow[]>;
}) {
  return (
    /* Every section is closed to begin with, so the page opens as an index of
       the menu rather than several thousand words of it. Twenty-six food
       sections unrolled is a scroll nobody reads to the end of; closed, the
       whole repertoire is legible at a glance and the reader chooses what to
       open.

       <details> rather than React state: this stays a server component, it
       works before hydration and without JavaScript at all, and the keyboard
       and screen-reader behaviour is the browser's own rather than something
       re-implemented with divs and aria attributes. */
    <div className="grid gap-3 sm:gap-3.5">
      {categories.map((cat) => {
        const items = itemsByCategory.get(cat.id) ?? [];
        if (!items.length) return null;
        return (
          <details key={cat.id} id={cat.slug} className="menu-section scroll-mt-28 group">
            <summary className="menu-summary">
              <span className="min-w-0">
                <span className="display block text-xl sm:text-2xl text-gold leading-tight">
                  {cat.name}
                </span>
                {cat.pricePence != null && (
                  <span className="tnum block text-sm text-gold/80 mt-1.5">
                    {formatPence(cat.pricePence)} per person
                  </span>
                )}
                {cat.note && (
                  <span className="block text-sm text-pale/60 mt-1.5 italic">{cat.note}</span>
                )}
              </span>

              <span className="menu-count accent shrink-0">
                {items.length} {items.length === 1 ? "dish" : "dishes"}
                <svg className="menu-chevron" viewBox="0 0 12 12" aria-hidden="true">
                  <path d="M2.5 4.5 6 8l3.5-3.5" fill="none" stroke="currentColor"
                        strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </span>
            </summary>

            <div className="menu-body">
              <ul className="grid gap-7 pt-8">
                {items.map((item) => (
                  <li key={item.id}>
                    <div className="flex items-baseline gap-3">
                      <span className="font-semibold">
                        {item.name}
                        {item.isSignature && (
                          <span className="accent text-[0.5rem] text-gold ml-2.5 align-middle">Signature</span>
                        )}
                      </span>
                      <span className="flex-1 border-b border-dotted border-gold/30 -translate-y-1 min-w-6" />
                      <Price measure={item.measure} pence={item.pricePence} />
                      {item.pricePence2 != null && (
                        <span className="pl-3"><Price measure={item.measure2} pence={item.pricePence2} /></span>
                      )}
                    </div>
                    {item.meta && (
                      <p className="display italic text-[0.82rem] text-gold mt-1">{item.meta}</p>
                    )}
                    {item.description && (
                      <p className="text-sm text-pale/70 mt-1 max-w-[62ch] leading-relaxed italic">{item.description}</p>
                    )}
                    {item.dietary && (
                      <p className="text-xs text-pale/45 mt-1.5">
                        {item.dietary.split(",").filter(Boolean).map((c) => DIETARY_LABELS[c] ?? c).join(" · ")}
                      </p>
                    )}
                  </li>
                ))}
              </ul>

              {cat.image && (
                <div className="relative h-56 sm:h-72 mt-12 overflow-hidden rounded-2xl">
                  <Image src={cat.image} alt="" fill sizes="(min-width: 1024px) 900px, 100vw" className="object-cover" />
                </div>
              )}
            </div>
          </details>
        );
      })}
    </div>
  );
}

/** The sticky section jump bar — 26 food sections is a lot of scrolling. */
export function MenuJumpNav({ categories }: { categories: MenuCategoryRow[] }) {
  if (categories.length < 3) return null;
  return (
    <nav aria-label="Menu sections" className="sticky top-20 sm:top-24 z-30 bg-ink/95 backdrop-blur border-y border-[--line]">
      <ul className="mx-auto max-w-[84rem] px-5 lg:px-10 flex gap-x-6 overflow-x-auto py-3.5 text-[0.82rem]">
        {categories.map((c) => (
          <li key={c.id} className="whitespace-nowrap">
            <a href={`#${c.slug}`} className="text-pale/70 hover:text-gold">{c.name}</a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
