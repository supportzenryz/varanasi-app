import "server-only";
import fs from "node:fs";
import path from "node:path";

/** Brand assets and per-branch page media, read from data/site.json.
 *  Content that the client edits lives in the database; this is the fixed
 *  furniture — logo, favicon, award badge, page hero art. */
type Brand = {
  logo: string; logoDark: string; logoIcon: string; wordmark: string;
  favicon: string; appleTouchIcon: string; socialImage: string;
  award: string; awardAlt: string; giftVoucherImage: string; divider: string;
};
type BranchMedia = {
  collage: string[];
  menuHero: string;
  drinksHero: string;
  privateDiningHero: string;
  menuBanners: string[];
  /* The short films. Optional on purpose: Leicester has the food reel but not
     the restaurant film, and a branch with neither must still render. */
  /** A portrait reel of the food — phone-shaped, so it is shown at its own size. */
  filmVideo?: string;
  filmPoster?: string;
  /** The long cinematic film of the room, for the private dining banner. */
  roomFilmVideo?: string;
  roomFilmPoster?: string;
};

const file = path.join(process.cwd(), "data", "site.json");
const data = JSON.parse(fs.readFileSync(file, "utf8")) as {
  brand: Brand;
  branches: Record<string, BranchMedia>;
};

export const brand: Brand = data.brand;

export function branchMedia(slug: string): BranchMedia {
  return data.branches[slug] ?? data.branches.birmingham;
}
