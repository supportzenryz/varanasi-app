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
    <div className="grid gap-16 sm:gap-20">
      {categories.map((cat) => {
        const items = itemsByCategory.get(cat.id) ?? [];
        if (!items.length) return null;
        return (
          <section key={cat.id} id={cat.slug} className="scroll-mt-28">
            <header className="text-center">
              <h2 className="display text-2xl sm:text-[2rem] text-gold">{cat.name}</h2>
              {cat.pricePence != null && (
                <p className="tnum text-sm text-gold mt-2">{formatPence(cat.pricePence)} per person</p>
              )}
              {cat.note && <p className="text-sm text-pale/70 mt-2 italic">{cat.note}</p>}
              <div className="rule mt-5" aria-hidden="true">◆</div>
            </header>

            <ul className="mt-9 grid gap-7">
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
              <div className="relative h-56 sm:h-72 mt-14 -mx-5 lg:mx-0 overflow-hidden">
                <Image src={cat.image} alt="" fill sizes="(min-width: 1024px) 900px, 100vw" className="object-cover" />
              </div>
            )}
          </section>
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
