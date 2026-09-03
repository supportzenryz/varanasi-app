/**
 * Turns the captured pages into renderable fragments so the rebuilt app can serve
 * the original UI byte-for-byte — same markup, same YOOtheme CSS, same UIkit effects.
 * Asset URLs are repointed at /media, internal links at /exact.
 */
import fs from "node:fs";
import path from "node:path";

const SRC = "/home/claude/capture/pages";
const OUT = "src/exact/pages";
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

const ASSET_DIRS = ["wp-content", "wp-includes", "cdn-cgi"];

function rewrite(html) {
  let s = html;

  // absolute asset URLs -> /media
  for (const d of ASSET_DIRS) {
    s = s.replaceAll(`https://varanasi.uk/birmingham/${d}/`, `/media/birmingham/${d}/`);
    s = s.replaceAll(`https://varanasi.uk/leicester/${d}/`, `/media/leicester/${d}/`);
    s = s.replaceAll(`https://varanasi.uk/${d}/`, `/media/${d}/`);
    s = s.replaceAll(`"/birmingham/${d}/`, `"/media/birmingham/${d}/`);
    s = s.replaceAll(`"/leicester/${d}/`, `"/media/leicester/${d}/`);
    s = s.replaceAll(`'/birmingham/${d}/`, `'/media/birmingham/${d}/`);
    s = s.replaceAll(`'/leicester/${d}/`, `'/media/leicester/${d}/`);
    s = s.replaceAll(`(/birmingham/${d}/`, `(/media/birmingham/${d}/`);
    s = s.replaceAll(`(/leicester/${d}/`, `(/media/leicester/${d}/`);
    s = s.replaceAll(`"/${d}/`, `"/media/${d}/`);
    s = s.replaceAll(`'/${d}/`, `'/media/${d}/`);
    // catch anything the quote-anchored replacements miss — srcset entries are
    // comma-separated, so their URLs are not preceded by a quote
    s = s.replace(
      new RegExp(`(?<!/media)(?<!/media/birmingham)(?<!/media/leicester)/(birmingham/|leicester/)?${d}/`, "g"),
      (_m, branch) => `/media/${branch ?? ""}${d}/`);
  }

  // internal page links stay inside the exact preview
  s = s.replaceAll('href="https://varanasi.uk/', 'href="/exact/');
  s = s.replaceAll("href='https://varanasi.uk/", "href='/exact/");
  s = s.replace(/href="\/(birmingham|leicester)([^"]*)"/g, 'href="/exact/$1$2"');
  s = s.replace(/href="\/(menu|book-online|gift-vouchers|contact|gallery|catering|corporate-dining-events|private-dining-experiences|franchise-opportunities|privacy|terms)\//g,
                'href="/exact/$1/');

  // strip the version query strings — the captured files have plain names
  s = s.replace(/(\/media\/[^"'\s)]+?)\?[^"'\s)]*/g, "$1");
  return s;
}

function stripJunk(body) {
  return body
    // WordPress emoji shim and speculation rules add nothing to the design
    .replace(/<script[^>]*id=["']wp-emoji[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<script[^>]*type=["']speculationrules["'][^>]*>[\s\S]*?<\/script>/gi, "")
    // we load the theme's scripts ourselves, in order, from the route
    .replace(/<script[^>]+src=["'][^"']*(?:jquery|uikit|theme\.js|cookie\.min)[^"']*["'][^>]*><\/script>/gi, "")
    .replace(/<link[^>]+rel=["']stylesheet["'][^>]*>/gi, "");
}

const pick = (re, s) => { const m = s.match(re); return m ? m[1] : ""; };
const index = [];

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) { walk(full); continue; }
    if (!entry.name.endsWith(".html")) continue;

    const rel = path.relative(SRC, full).replaceAll(path.sep, "/");
    // /birmingham/menu/index.html -> birmingham/menu ; /index.html -> ""
    let slug = rel.replace(/index\.html$/, "").replace(/\.html$/, "").replace(/\/$/, "");
    if (slug.includes("/dish/") || slug.startsWith("author/") || slug.startsWith("cdn-cgi")) continue;

    const raw = fs.readFileSync(full, "utf8");
    const title = pick(/<title>([^<]*)<\/title>/i, raw).replace(/\s+/g, " ").trim();
    const description = pick(/<meta name="description" content="([^"]*)"/i, raw);
    const bodyClass = pick(/<body[^>]*class=["']([^"']*)["']/i, raw);
    const branch = slug.startsWith("leicester") ? "leicester" : "birmingham";

    const start = raw.indexOf(">", raw.indexOf("<body")) + 1;
    const end = raw.lastIndexOf("</body>");
    const body = rewrite(stripJunk(raw.slice(start, end)));

    const file = `${slug || "home"}.html`.replaceAll("/", "__");
    fs.writeFileSync(path.join(OUT, file), body);
    index.push({ slug, file, title, description, bodyClass, branch, bytes: body.length });
  }
}
walk(SRC);

index.sort((a, b) => a.slug.localeCompare(b.slug));
fs.writeFileSync("src/exact/index.json", JSON.stringify(index, null, 1));
console.log(`${index.length} pages converted`);
console.log(index.slice(0, 6).map((p) => `  /${p.slug}  ${(p.bytes / 1024).toFixed(0)}kb  ${p.title}`).join("\n"));
