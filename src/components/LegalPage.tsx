import type { LegalDoc } from "@/lib/legal";

/** Renders a transcribed legal document: headings, paragraphs and lists. */
export function LegalBody({ doc }: { doc: LegalDoc }) {
  return (
    <div className="grid gap-10">
      {doc.sections.map((section, i) => {
        const lists = section.blocks.filter((b) => b.list);
        const paras = section.blocks.filter((b) => !b.list);
        return (
          <section key={`${section.heading}-${i}`}>
            {section.heading && (
              <h2 className="display text-xl sm:text-2xl text-gold">{section.heading}</h2>
            )}
            {paras.length > 0 && (
              <div className={`grid gap-4 ${section.heading ? "mt-4" : ""}`}>
                {paras.map((b, j) => (
                  <p key={j} className="text-pale/75 leading-relaxed">{b.text}</p>
                ))}
              </div>
            )}
            {lists.length > 0 && (
              <ul className="mt-4 grid gap-2.5">
                {lists.map((b, j) => (
                  <li key={j} className="flex gap-3 text-pale/75 leading-relaxed">
                    <span className="text-gold shrink-0" aria-hidden="true">◆</span>
                    <span>{b.text}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        );
      })}
    </div>
  );
}
