/* The QR encoder, proved by decoding what it draws.
 *
 * A hand-written QR encoder that is subtly wrong produces something that looks
 * exactly like a QR code and cannot be scanned — wrong format bits, one
 * codeword out of order, a transposed corner — and the picture is
 * indistinguishable to a human eye. "It renders" proves nothing at all, and
 * neither does a screenshot.
 *
 * So every case below is rendered to an image and read back by OpenCV's
 * detector, the same class of software as the camera app on a phone. If the
 * text comes back, the symbol is right.
 *
 * There is a second, weaker check against Python's `qrcode` library: the same
 * text must choose the same VERSION (symbol size), which is what catches a
 * wrong capacity table. Deliberately not module-for-module. Eight mask
 * patterns are legal for any symbol and the specification's scoring can tie or
 * come close, so two correct encoders may pick different masks and produce
 * different — equally scannable — pictures. An earlier version of this suite
 * asserted equality and reported five failures on symbols that every decoder
 * reads perfectly well.
 *
 * Needs two Python packages, which are only for this suite:
 *   pip install opencv-python-headless numpy qrcode --break-system-packages
 *
 *   npm run test:qr
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { execFileSync } from "node:child_process";

const root = new URL("../", new URL(".", import.meta.url));
/* Windows.
 *
 * Two things about `await import()` and paths, and both of them bite only on
 * Windows, which is where this project is actually developed:
 *
 *  - a dynamic import needs a `file://` URL, not a path. `await import("C:\\…")`
 *    is read as a URL with the scheme "c:" and refused outright
 *    (ERR_UNSUPPORTED_ESM_URL_SCHEME). `pathToFileURL(...).href` is the fix.
 *  - `new URL(".", …).pathname` is `/C:/Users/…`, with a leading slash, so
 *    joining it produces `C:\\C:\\Users\\…`. `fileURLToPath` is the fix.
 *
 * Neither shows up on Linux, so a suite written there passes and then fails on
 * the machine that matters. */
const projectRoot = fileURLToPath(new URL(".", root));
const dir = path.join(projectRoot, ".tmp-qr-test");
fs.rmSync(dir, { recursive: true, force: true });
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(path.join(dir, "qr.ts"),
  fs.readFileSync(new URL("src/lib/qr.ts", root), "utf8").replace(/^import "server-only";\s*$/m, ""));
const { qrMatrix, qrSvg } = await import(pathToFileURL(path.join(dir, "qr.ts")).href);

let pass = 0, fail = 0;
const t = (name: string, ok: boolean, extra = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${extra ? " — " + extra : ""}`);
  if (ok) pass++; else fail++;
};

const rowsOf = (text: string): string[] =>
  qrMatrix(text).modules.map((row: boolean[]) => row.map((v) => (v ? "1" : "0")).join(""));

/* Rendered at eight pixels a module with the four-module quiet zone, which is
   roughly what a printed voucher offers a phone camera. */
const DECODER = `
import sys, json
import numpy as np, cv2
rows = json.loads(sys.argv[1])
scale, quiet = 8, 4
n = len(rows)
side = (n + 2 * quiet) * scale
img = np.ones((side, side), dtype=np.uint8) * 255
for r, row in enumerate(rows):
    for c, ch in enumerate(row):
        if ch == '1':
            y, x = (r + quiet) * scale, (c + quiet) * scale
            img[y:y+scale, x:x+scale] = 0
ok, decoded, _, _ = cv2.QRCodeDetector().detectAndDecodeMulti(img)
print(json.dumps({"ok": bool(ok), "text": list(decoded) if ok else []}))
`;

/* `python3` on Linux and macOS, `python` on Windows — and on Windows a bare
   `python` may be Microsoft's stub that only offers to install it, so a
   successful import is what counts as finding one, not the command existing. */
function findPython(): string | null {
  for (const cmd of ["python3", "python", "py"]) {
    try {
      execFileSync(cmd, ["-c", "import cv2, numpy, qrcode"], { stdio: "ignore" });
      return cmd;
    } catch { /* try the next one */ }
  }
  return null;
}

const PY = findPython();
if (!PY) {
  console.log("\n  This suite needs Python with two packages, for verification only:\n");
  console.log("    pip install opencv-python-headless numpy qrcode\n");
  console.log("  It renders each code to an image and reads it back with a real decoder, so");
  console.log("  without them it cannot prove the codes are readable — and it fails rather");
  console.log("  than reporting a pass it has not earned. On Windows this one is mine to run.\n");
  process.exit(1);
}

function decode(rows: string[]): string | null {
  const out = execFileSync(PY!, ["-c", DECODER, JSON.stringify(rows)]).toString();
  const result = JSON.parse(out) as { ok: boolean; text: string[] };
  return result.ok && result.text.length === 1 ? result.text[0] : null;
}

/** The version an independent encoder picks for the same bytes. */
const REFERENCE = `
import json, sys
import qrcode
from qrcode.constants import ERROR_CORRECT_M
from qrcode.util import QRData, MODE_8BIT_BYTE
q = qrcode.QRCode(error_correction=ERROR_CORRECT_M, border=0)
q.add_data(QRData(sys.argv[1].encode("utf-8"), mode=MODE_8BIT_BYTE, check_data=False))
q.make(fit=True)
print(json.dumps({"size": len(q.modules)}))
`;

function referenceSize(text: string): number {
  return JSON.parse(execFileSync(PY!, ["-c", REFERENCE, text]).toString()).size;
}

/* Lengths chosen to land on every version from 1 to 10, and on the byte
   exactly before and after a capacity boundary — a capacity table that is
   wrong is wrong at the boundary and nowhere else. */
const cases: [string, string][] = [
  ["a single character", "A"],
  ["a voucher code", "VG-4K7Q-P2M9"],
  ["a voucher URL", "https://varanasi.uk/admin/vouchers?code=VG-4K7Q-P2M9-X3TB"],
  ["the live Railway URL", "https://varanasi-app-production.up.railway.app/admin/vouchers?code=VG-4K7Q"],
  ["14 bytes — fills version 1", "0123456789abcd"],
  ["15 bytes — first that needs version 2", "0123456789abcde"],
  ["26 bytes — fills version 2", "0123456789abcdefghijklmnop"],
  ["27 bytes — first that needs version 3", "0123456789abcdefghijklmnopq"],
  ["42 bytes — fills version 3", "a".repeat(42)],
  ["43 bytes — first that needs version 4", "a".repeat(43)],
  ["62 bytes — fills version 4", "b".repeat(62)],
  ["84 bytes — fills version 5", "c".repeat(84)],
  ["106 bytes — fills version 6", "d".repeat(106)],
  ["122 bytes — fills version 7, the first with version information", "e".repeat(122)],
  ["152 bytes — fills version 8", "f".repeat(152)],
  ["180 bytes — fills version 9, two block groups", "g".repeat(180)],
  ["213 bytes — fills version 10", "h".repeat(213)],
  ["digits, which we deliberately encode as bytes", "1234567890123456789012345"],
  ["a pound sign, two bytes in UTF-8", "£50 at Varanasi Birmingham"],
  ["an em dash and a curly apostrophe", "Varanasi — Emily’s voucher"],
];

console.log("\n── Every symbol reads back as what went in ──");
for (const [name, text] of cases) {
  const rows = rowsOf(text);
  const back = decode(rows);
  t(name, back === text, back === text ? `${rows.length}×${rows.length}` : `decoded as ${JSON.stringify(back)}`);
}

console.log("\n── The same size as an independent encoder picks ──");
for (const [name, text] of cases) {
  const ours = rowsOf(text).length;
  const theirs = referenceSize(text);
  t(name, ours === theirs, ours === theirs ? `${ours}×${ours}` : `${ours} vs ${theirs}`);
}

console.log("\n── The SVG ──");
{
  const svg = qrSvg("VG-TEST", { size: 200, label: "Voucher VG-TEST" });
  t("is a single self-contained element", svg.startsWith("<svg") && svg.endsWith("</svg>"));
  t("carries no external reference", !/https?:\/\/(?!www\.w3\.org)/.test(svg));
  t("has a label for a screen reader", svg.includes('aria-label="Voucher VG-TEST"'));
  t("asks the browser not to antialias the modules", svg.includes('shape-rendering="crispEdges"'));
  t("draws one path rather than a rectangle per module",
    (svg.match(/<path/g) ?? []).length === 1 && !svg.includes("<rect x"));
  t("paints a white ground, so it scans on a dark page", svg.includes('fill="#ffffff"'));
  const size = qrMatrix("VG-TEST").size;
  t("leaves the four-module quiet zone a scanner needs",
    qrSvg("VG-TEST", { quiet: 4 }).includes(`viewBox="0 0 ${size + 8} ${size + 8}"`));
}

console.log("\n── Limits ──");
{
  let threw = false;
  try { qrMatrix("z".repeat(400)); } catch { threw = true; }
  t("refuses text it cannot encode rather than drawing something unreadable", threw);
}

console.log("\n" + "─".repeat(60));
console.log(`${pass}/${pass + fail} checks passed`);
try {
  fs.rmSync(dir, { recursive: true, force: true });
} catch {
  console.log(`  (could not remove ${path.basename(dir)} — it will be cleared on the next run)`);
}
process.exit(fail ? 1 : 0);
