/**
 * Copies Varanasi's media into public/media. There are two trees, and this
 * script handles both — point it at either one, or run it twice:
 *
 *   1. The WordPress media library (birmingham/2024/07/..., leicester/2025/03/...)
 *      This is what the rebuilt site uses. It lands in public/media/lib and is
 *      what every path in data/site.json and data/rooms.json refers to.
 *
 *        npm run media:import -- "C:/Users/sathi/Downloads/varanasi_export/varanasi-app/media"
 *
 *   2. The page capture's assets (wp-content/..., wp-includes/...)
 *      This is what the /exact reproduction replays. It lands in public/media.
 *
 *        npm run media:import -- "C:/Users/sathi/Downloads/varanasi_export/live-capture/assets"
 *
 * Which tree it is gets detected from the folder's own shape, so you don't have
 * to remember a flag. The theme's woff2 fonts ship with this repo — the capture
 * doesn't contain them, because they're referenced only from inside the theme
 * stylesheet.
 */
import fs from "node:fs";
import path from "node:path";

const src = process.argv[2];
if (!src) {
  console.error("Usage: npm run media:import -- <path to the media folder>");
  console.error("  media library : .../varanasi-app/media");
  console.error("  page capture  : .../live-capture/assets");
  process.exit(1);
}
if (!fs.existsSync(src)) {
  console.error(`Not found: ${src}`);
  process.exit(1);
}

const publicMedia = path.join(process.cwd(), "public", "media");
const FONTS = path.join("wp-content", "themes", "yootheme", "fonts");

/** The capture tree has wp-content/wp-includes at or just below its root. */
function looksLikeCapture(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory());
  if (entries.some((e) => e.name === "wp-content" || e.name === "wp-includes")) return true;
  return entries.some((e) => {
    const inner = path.join(dir, e.name);
    try {
      return fs.readdirSync(inner).some((n) => n === "wp-content" || n === "wp-includes");
    } catch {
      return false;
    }
  });
}

const isCapture = looksLikeCapture(src);
const dest = isCapture ? publicMedia : path.join(publicMedia, "lib");

let copied = 0, skipped = 0;
function walk(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const e of fs.readdirSync(from, { withFileTypes: true })) {
    const f = path.join(from, e.name), t = path.join(to, e.name);
    if (e.isDirectory()) { walk(f, t); continue; }
    if (fs.existsSync(t) && fs.statSync(t).size === fs.statSync(f).size) { skipped++; continue; }
    fs.copyFileSync(f, t); copied++;
  }
}
walk(src, dest);

if (isCapture) {
  // the three theme copies use identical faces; mirror whichever set we have
  const have = ["birmingham", "leicester", ""].map((b) => path.join(publicMedia, b, FONTS)).find(
    (p) => fs.existsSync(p) && fs.readdirSync(p).length > 0
  );
  if (have) {
    for (const b of ["birmingham", "leicester", ""]) {
      const target = path.join(publicMedia, b, FONTS);
      if (target === have || !fs.existsSync(path.dirname(target))) continue;
      fs.mkdirSync(target, { recursive: true });
      for (const f of fs.readdirSync(have)) {
        const t = path.join(target, f);
        if (!fs.existsSync(t)) { fs.copyFileSync(path.join(have, f), t); copied++; }
      }
    }
  } else {
    console.warn("! No theme fonts found — the exact preview will fall back to system faces.");
  }
}

/* The page capture missed a handful of images that ARE in the media library
 * (WordPress served some of them from paths the crawler never followed). Mirror
 * library files into the upload paths the /exact pages ask for, without ever
 * overwriting something the capture did collect. */
if (!isCapture) {
  const lib = dest;
  let filled = 0;
  const branches = fs.existsSync(lib)
    ? fs.readdirSync(lib, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name)
    : [];
  for (const branch of branches) {
    const root = path.join(lib, branch);
    const walkYears = (dir, rel) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const f = path.join(dir, e.name);
        if (e.isDirectory()) { walkYears(f, `${rel}/${e.name}`); continue; }
        for (const target of [
          path.join(publicMedia, branch, "wp-content", "uploads", ...rel.split("/").filter(Boolean), e.name),
          path.join(publicMedia, "wp-content", "uploads", ...rel.split("/").filter(Boolean), e.name),
        ]) {
          if (fs.existsSync(target)) continue;
          if (!fs.existsSync(path.dirname(path.dirname(target)))) continue; // capture tree not imported
          fs.mkdirSync(path.dirname(target), { recursive: true });
          fs.copyFileSync(f, target);
          filled++;
        }
      }
    };
    if (fs.statSync(root).isDirectory()) walkYears(root, "");
  }
  if (filled) console.log(`filled ${filled} gaps in the page capture from the library`);
}

console.log(`${isCapture ? "page capture" : "media library"}: ${copied} copied, ${skipped} already present`);
console.log(`-> ${dest}`);
if (!isCapture) console.log("the rebuilt site reads from here (see data/site.json)");
