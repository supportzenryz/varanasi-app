/* Contact-detail validation.
 *
 * The point of these cases is the first block: real numbers, in the messy
 * shapes people actually type them. Over-blocking is the expensive failure
 * here — a rejected genuine booking costs a cover, while an odd number that
 * gets through costs nothing, because a human reads it before dialling.
 *
 *   npm run test:validate
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/* validate.ts imports "@/lib/whatsapp" via the tsconfig alias, which tsx does
   not resolve outside Next. Load copies with the alias rewritten to a relative
   path — the code itself is untouched. */
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "validate-test-"));
const here = new URL(".", import.meta.url);
for (const f of ["whatsapp.ts", "validate.ts"]) {
  const src = fs.readFileSync(new URL(`../src/lib/${f}`, here), "utf8");
  fs.writeFileSync(path.join(dir, f), src.replace(/@\/lib\//g, "./").replace(/^import "server-only";\s*$/m, ""));
}
const { checkPhone, checkEmail, checkName } = await import(path.join(dir, "validate.ts"));

/* parsePounds lives in money.ts and has no imports to rewrite. It is here
   because it is the same class of problem: input a member of staff types. */
fs.writeFileSync(path.join(dir, "money.ts"),
  fs.readFileSync(new URL("../src/lib/money.ts", here), "utf8"));
const { parsePounds } = await import(path.join(dir, "money.ts"));

let pass = 0, fail = 0;
const t = (name: string, ok: boolean, extra = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${extra ? " — " + extra : ""}`);
  ok ? pass++ : fail++;
};
const accepts = (raw: string, why = "") => {
  const r = checkPhone(raw);
  t(`accepts ${JSON.stringify(raw)}${why ? ` (${why})` : ""}`, r.ok, r.ok ? `-> ${r.value}` : r.error);
};
const rejects = (raw: string, why: string) => {
  const r = checkPhone(raw);
  t(`rejects ${JSON.stringify(raw)} (${why})`, !r.ok);
};

console.log("\n── Real UK numbers, as people type them ──");
accepts("07700 900123", "Ofcom test mobile");
accepts("07700900123");
accepts("+447700900123");
accepts("+44 7700 900123");
accepts("0044 7700 900123");
accepts("(07700) 900123");
accepts("07700-900-123");
accepts("0121 633 3700", "the Birmingham restaurant");
accepts("01216333700");
accepts("+44 121 633 3700");
accepts("020 7946 0958", "Ofcom test London");
accepts("0116 123 4567", "Leicester");
accepts("03000 111222", "non-geographic");
accepts("0561 234567", "056 is UK VoIP — rare, but real");
accepts("  07700 900123  ", "padded");

console.log("\n── International ──");
accepts("+33 6 12 34 56 78", "France");
accepts("+1 415 555 2671", "US");
accepts("+353 86 123 4567", "Ireland");

console.log("\n── Rubbish that used to get through ──");
rejects("", "empty when required");
rejects("abc", "letters");
rejects("07700 90012a", "letter hidden in digits");
rejects("1", "single digit");
rejects("123", "far too short");
rejects("1111111111", "one digit repeated");
rejects("0000000000", "all zeros");
rejects("1234567890", "sequential");
rejects("0987654321", "reverse sequential");
rejects("07700", "too short for a mobile");
rejects("077009001234567", "too long");
rejects("0470 900123", "UK numbers never start 04");
rejects("0670 900123", "UK numbers never start 06");
rejects("0900123", "UK numbers never start 09 at this length");

console.log("\n── Phone optional (enquiry forms) ──");
t("blank is allowed when not required", checkPhone("", false).ok);
t("blank returns an empty value, not a fake one", checkPhone("", false).value === "");
t("rubbish is still rejected when not required", !checkPhone("abc", false).ok);

console.log("\n── Email ──");
for (const e of ["guest@gmail.com", "first.last@btinternet.com", "a.b+tag@sub.example.co.uk", "x_y@example.org"]) {
  const r = checkEmail(e);
  t(`accepts ${e}`, r.ok, r.ok ? "" : r.error);
}
for (const [e, why] of [
  ["", "empty"], ["guest", "no @"], ["guest@", "no domain"], ["@gmail.com", "no local part"],
  ["guest@@gmail.com", "two @"], ["guest@gmail", "no dot in domain"],
  ["guest@gmail.c", "one-letter TLD"], ["a@b.c", "the old regex allowed this"],
  ["guest@gmail..com", "double dot"], [".guest@gmail.com", "leading dot"],
  ["guest.@gmail.com", "trailing dot"], ["guest@-gmail.com", "domain starts with a dash"],
  ["guest@gmail.com.", "trailing dot on domain"], ["guest@1.2.3.4", "numeric TLD"],
] as [string, string][]) {
  t(`rejects ${JSON.stringify(e)} (${why})`, !checkEmail(e).ok);
}
const typo = checkEmail("guest@gmial.com");
t("catches gmial.com and suggests the fix", !typo.ok && /gmail\.com/.test((typo as any).error),
  (typo as any).error);
t("normalises case and padding", (checkEmail("  Guest@GMAIL.com ") as any).value === "guest@gmail.com");

console.log("\n── Name ──");
for (const n of ["Asha", "Jo Patel", "Seán Ó Briain", "Anne-Marie de la Cruz", "李小龍"]) {
  const r = checkName(n);
  t(`accepts ${JSON.stringify(n)}`, r.ok, r.ok ? "" : r.error);
}
for (const [n, why] of [["", "empty"], ["a", "one character"], ["...", "punctuation only"],
  ["1", "a digit"], ["http://spam.example", "a URL"]] as [string, string][]) {
  t(`rejects ${JSON.stringify(n)} (${why})`, !checkName(n).ok);
}
t("collapses runaway whitespace", (checkName("  Jo    Patel ") as any).value === "Jo Patel");

console.log("\n── Money typed by staff ──");
for (const [input, expected, why] of [
  ["10", 1000, "plain pounds"],
  ["10.50", 1050, "pence"],
  ["£25", 2500, "with a currency symbol"],
  ["1,250", 125000, "thousands separator"],
  ["  40  ", 4000, "padded"],
] as [string, number, string][]) {
  t(`accepts ${JSON.stringify(input)} (${why})`, parsePounds(input) === expected, String(parsePounds(input)));
}
for (const [input, why] of [
  ["-10", "negative — used to come back as +£10 and take the money again"],
  ["14 / 18", "two measures in one box — used to become £1,418 on the live menu"],
  ["1e9", "exponent — used to become £19"],
  ["12.50.60", "two decimal points"],
  ["14.999", "more precision than money has"],
  ["TBC", "not a number — used to silently clear the stored price"],
  ["", "empty"],
] as [string, string][]) {
  t(`refuses ${JSON.stringify(input)} (${why})`, parsePounds(input) === null, String(parsePounds(input)));
}

console.log(`\n${"─".repeat(60)}\n${pass}/${pass + fail} checks passed\n`);
process.exit(fail ? 1 : 0);
