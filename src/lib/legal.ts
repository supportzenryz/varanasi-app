import "server-only";
import fs from "node:fs";
import path from "node:path";

/**
 * Privacy policy and terms, transcribed verbatim from the live site.
 *
 * Deliberately NOT in the database and NOT editable in the admin: this is
 * legal text with named individuals and stated obligations in it. Someone
 * changing a data-retention clause from a CMS text box between coffees is not
 * a feature. Changes go through the client and land here as a file.
 */
export type LegalBlock = { text: string; list?: boolean };
export type LegalSection = { heading: string; blocks: LegalBlock[] };
export type LegalDoc = { title: string; sections: LegalSection[] };

const file = path.join(process.cwd(), "data", "legal.json");
const data = JSON.parse(fs.readFileSync(file, "utf8")) as {
  privacy: LegalDoc;
  terms: LegalDoc;
  _reviewNotes?: string[];
};

export const privacyDoc: LegalDoc = data.privacy;
export const termsDoc: LegalDoc = data.terms;
/** Points the client still needs to resolve; surfaced in the admin, not publicly. */
export const legalReviewNotes: string[] = data._reviewNotes ?? [];
