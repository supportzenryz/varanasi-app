import "server-only";
import { openingHours, type Branch } from "@/lib/branches";
import { siteUrl } from "@/lib/site";

/**
 * Structured data — what Google shows about the restaurant before anyone
 * clicks.
 *
 * Page titles and descriptions were already in place on every route. What was
 * missing is the machine-readable half, and for a restaurant it is the half
 * that shows: the panel on the right of a search for "Varanasi Birmingham"
 * carrying the address, today's hours, the phone number and a Reserve button
 * is drawn from this and nothing else. Without it, two branches of the same
 * business in two cities are two pages Google has to guess about — and it
 * guesses by merging them, which is exactly the confusion the client asked us
 * to stop.
 *
 * Everything below is read from the database, so the hours in the search
 * result change when a manager edits them in the admin, rather than when
 * somebody remembers there is a second copy.
 *
 * Deliberately conservative: only facts the restaurant actually holds. No
 * invented ratings, no `aggregateRating` — marking up a rating the site does
 * not display is against Google's own guidelines and is the usual reason a
 * restaurant's rich result quietly disappears.
 */

const DAY: Record<string, string> = {
  monday: "Monday", tuesday: "Tuesday", wednesday: "Wednesday", thursday: "Thursday",
  friday: "Friday", saturday: "Saturday", sunday: "Sunday",
};

/** "17:30" from whatever the admin holds, or null if it isn't a time. */
function time(value: string | undefined): string | null {
  const m = /^(\d{1,2}):(\d{2})/.exec((value ?? "").trim());
  if (!m) return null;
  const h = Number(m[1]);
  if (h > 23 || Number(m[2]) > 59) return null;
  return `${String(h).padStart(2, "0")}:${m[2]}`;
}

export function restaurantJsonLd(branch: Branch, opts: { image?: string } = {}): string {
  const base = siteUrl();
  const url = `${base}/${branch.slug}`;

  const hours = openingHours(branch)
    .filter((h) => !h.closed)
    .map((h) => {
      const day = DAY[h.day?.toLowerCase() ?? ""];
      const opens = time(h.open);
      const closes = time(h.close);
      /* A malformed row is left out rather than emitted half-complete.
         Google treats an OpeningHoursSpecification missing `opens` as an
         error on the whole item, which loses the entire panel — not just
         that day. */
      if (!day || !opens || !closes) return null;
      return { "@type": "OpeningHoursSpecification", dayOfWeek: day, opens, closes };
    })
    .filter(Boolean);

  const data: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "Restaurant",
    "@id": `${url}#restaurant`,
    name: branch.name,
    url,
    telephone: branch.phone,
    servesCuisine: "Indian",
    /* Google's own scale, and honest for a restaurant with a £65 set menu.
       It is one of the few fields that affects whether the result is shown
       at all for "fine dining" style queries. */
    priceRange: "££££",
    acceptsReservations: `${url}/book-online`,
    hasMenu: `${url}/menu`,
    address: {
      "@type": "PostalAddress",
      streetAddress: branch.addressLine,
      addressLocality: branch.city,
      postalCode: branch.postcode,
      addressCountry: "GB",
    },
  };

  if (branch.email) data.email = branch.email;
  if (branch.intro) data.description = branch.intro;
  if (hours.length) data.openingHoursSpecification = hours;
  if (opts.image) data.image = opts.image.startsWith("http") ? opts.image : `${base}${opts.image}`;
  /* The Google Maps listing, which is how Google ties this page to the place
     it already knows about rather than treating them as two businesses. */
  if (branch.mapsUrl) data.sameAs = [branch.mapsUrl];

  return JSON.stringify(data);
}

/** The two restaurants as one organisation, for the front door. */
export function organisationJsonLd(branches: Branch[]): string {
  const base = siteUrl();
  return JSON.stringify({
    "@context": "https://schema.org",
    "@type": "Organization",
    "@id": `${base}/#organisation`,
    name: "Varanasi",
    url: base,
    description: "Indian fine dining in Birmingham and Leicester.",
    department: branches.map((b) => ({
      "@type": "Restaurant",
      "@id": `${base}/${b.slug}#restaurant`,
      name: b.name,
      url: `${base}/${b.slug}`,
      telephone: b.phone,
      address: {
        "@type": "PostalAddress",
        streetAddress: b.addressLine,
        addressLocality: b.city,
        postalCode: b.postcode,
        addressCountry: "GB",
      },
    })),
  });
}
