/**
 * Shared contact-detail validation for every public form.
 *
 * What this is and isn't for. The deposit is what actually protects the
 * restaurant from fake bookings: nothing is confirmed until money arrives, and
 * an unpaid hold expires on its own. So the job here is not fraud prevention —
 * it is making sure that when a real guest books, the restaurant can actually
 * reach them. A mistyped mobile is a table nobody can ring about a late
 * arrival; "asdf" in the phone box is a booking the kitchen can't chase.
 *
 * The bias throughout is deliberate: reject obvious rubbish, never reject a
 * real customer. Turning away a genuine booking costs a cover and an
 * apology; letting a slightly odd number through costs nothing, because a
 * human reads it before anyone dials it. Every rule below is checked against
 * the awkward-but-real cases in tests/validate.mts.
 */
import { toE164 } from "@/lib/whatsapp";

export type Check = { ok: true; value: string } | { ok: false; error: string };

/**
 * A phone check returns both forms on purpose.
 *
 * `value` is what the guest typed, tidied. That is what gets stored, because
 * it is what the restaurant's own staff recognise and what they type into the
 * admin search when a guest rings up — storing +441219000647 instead of
 * "0121 900 0647" turns every lookup into a miss.
 *
 * `e164` is the dialable form, for the WhatsApp sender and tel: links. Kept
 * alongside rather than instead, so neither use has to re-derive the other.
 */
export type PhoneCheck =
  | { ok: true; value: string; e164: string }
  | { ok: false; error: string };

/* ------------------------------------------------------------------ phone */

/** 1111111111, 0000000000 — a real number is never one digit repeated. */
function isRepeated(digits: string): boolean {
  return /^(\d)\1+$/.test(digits);
}

/** 1234567890 / 0987654321 — someone filling the box in, not a number. */
function isSequential(digits: string): boolean {
  if (digits.length < 6) return false;
  const up = "01234567890";
  const down = "09876543210";
  return up.includes(digits) || down.includes(digits);
}

/**
 * A UK national number is 10 or 11 digits including its leading zero. The
 * digit after that zero tells you the range, and only 0, 4 and 6 are
 * unassigned — so those are the only prefixes refused. 01/02 geographic,
 * 03 non-geographic, 05 corporate and VoIP, 07 mobile, 08 service,
 * 09 premium. 05 and 09 are rare on a booking form but they are real numbers,
 * and the rule here is never to reject a real customer.
 *
 * Nothing finer is checked on purpose: validating that 0121 is a live area
 * code means rejecting valid numbers every time Ofcom opens a new range.
 */
function ukProblem(e164: string): string | null {
  const nsn = e164.slice(3);                      // strip "+44"
  if (!/^[1235789]/.test(nsn)) {
    return "That doesn't look like a UK number. UK numbers start 01, 02, 03, 07 or 08.";
  }
  if (nsn.length < 9 || nsn.length > 10) {
    return "A UK number should be 10 or 11 digits, including the first 0.";
  }
  if (nsn.startsWith("7") && nsn.length !== 10) {
    return "A UK mobile should be 11 digits, like 07700 900123.";
  }
  return null;
}

/**
 * Accepts anything a UK guest plausibly types — spaces, brackets, dashes,
 * 0044, +44 — and returns it in E.164 so the stored value is dialable and the
 * WhatsApp sender doesn't have to guess. `required` is false on the enquiry
 * forms, where a phone number is a courtesy rather than a necessity.
 */
export function checkPhone(raw: string | null | undefined, required = true): PhoneCheck {
  const trimmed = (raw ?? "").trim().replace(/\s+/g, " ");
  if (!trimmed) {
    return required
      ? { ok: false, error: "Please give us a phone number in case we need to reach you." }
      : { ok: true, value: "", e164: "" };
  }

  // Letters are the giveaway for a filled-in-to-get-past-the-form entry.
  if (/[a-z]/i.test(trimmed)) {
    return { ok: false, error: "Please give us a phone number, digits only." };
  }

  const digits = trimmed.replace(/\D/g, "");
  if (digits.length < 7) return { ok: false, error: "That number looks too short. Please check it." };
  if (isRepeated(digits)) return { ok: false, error: "Please give us a real phone number we can reach you on." };
  if (isSequential(digits)) return { ok: false, error: "Please give us a real phone number we can reach you on." };

  const e164 = toE164(trimmed);
  if (!e164) return { ok: false, error: "We couldn't read that as a phone number. Please check it." };

  if (e164.startsWith("+44")) {
    const problem = ukProblem(e164);
    if (problem) return { ok: false, error: problem };
  }

  // As typed for the humans, E.164 for the machines.
  return { ok: true, value: trimmed, e164 };
}

/* ------------------------------------------------------------------ email */

/**
 * Typos in the big providers, which are by far the most common reason a
 * confirmation never arrives. Caught and named, rather than silently accepted:
 * the guest can fix it while they are still on the page.
 */
const DOMAIN_TYPOS: Record<string, string> = {
  "gmial.com": "gmail.com", "gmai.com": "gmail.com", "gmail.co": "gmail.com",
  "gmail.con": "gmail.com", "gmaill.com": "gmail.com", "gnail.com": "gmail.com",
  "hotmial.com": "hotmail.com", "hotmail.co": "hotmail.com", "hotmail.con": "hotmail.com",
  "outlok.com": "outlook.com", "outloo.com": "outlook.com",
  "yaho.com": "yahoo.com", "yahoo.co": "yahoo.com", "yahoo.con": "yahoo.com",
  "iclould.com": "icloud.com", "icloud.co": "icloud.com",
  "btinternet.co": "btinternet.com",
};

/**
 * Stricter than the one-@-and-a-dot test this replaces, which accepted `a@b.c`
 * and anything with a trailing dot. Still not an RFC parser, and deliberately
 * so: the only authority on whether an address exists is sending to it. This
 * catches the shapes that cannot exist.
 */
export function checkEmail(raw: string | null | undefined): Check {
  const value = (raw ?? "").trim().toLowerCase();
  if (!value) return { ok: false, error: "Please give us an email address so we can send your confirmation." };
  if (value.length > 254) return { ok: false, error: "That email address is too long." };

  const parts = value.split("@");
  if (parts.length !== 2) return { ok: false, error: "Please check that email address — it needs a single @." };

  const [local, domain] = parts;
  if (!local || local.length > 64) return { ok: false, error: "Please check that email address." };
  if (/^\.|\.$|\.\./.test(local)) return { ok: false, error: "Please check that email address." };
  if (/[^a-z0-9.!#$%&'*+/=?^_`{|}~-]/.test(local)) {
    return { ok: false, error: "Please check that email address — it contains a character that isn't allowed." };
  }

  // A domain needs a dot, a label either side of every dot, and a real TLD.
  if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(domain)) {
    return { ok: false, error: "Please check the part after the @." };
  }
  const tld = domain.slice(domain.lastIndexOf(".") + 1);
  if (tld.length < 2) return { ok: false, error: "Please check the part after the @." };
  if (/^\d+$/.test(tld)) return { ok: false, error: "Please check the part after the @." };

  const suggestion = DOMAIN_TYPOS[domain];
  if (suggestion) {
    return { ok: false, error: `Did you mean ${local}@${suggestion}? Please correct the email address.` };
  }

  return { ok: true, value };
}

/* ------------------------------------------------------------------- name */

/**
 * A name only has to be a name. The one thing worth refusing is a box filled
 * with punctuation or a single letter, which is what an automated submission
 * leaves behind — and which gives the restaurant nothing to greet a guest by.
 */
export function checkName(raw: string | null | undefined): Check {
  const value = (raw ?? "").trim().replace(/\s+/g, " ");
  if (!value) return { ok: false, error: "Please give us a name for the booking." };
  if (value.length < 2) return { ok: false, error: "Please give us your full name." };
  if (value.length > 120) return { ok: false, error: "That name is too long." };
  // At least two letters somewhere. Deliberately permissive about which
  // alphabet, so names in any script are accepted.
  if ((value.match(/\p{L}/gu) ?? []).length < 2) {
    return { ok: false, error: "Please give us your name as you'd like us to greet you." };
  }
  if (/https?:\/\/|www\./i.test(value)) {
    return { ok: false, error: "Please give us a name rather than a web address." };
  }
  return { ok: true, value };
}

/* ------------------------------------------------------- dates and times -- */

/**
 * A calendar date the admin will actually store, as "YYYY-MM-DD".
 *
 * The admin forms use <input type="date">, which gives that shape — but a form
 * post is not a form: anything can be sent to a server action, and
 * `date="banana"` was being written into the bookings table verbatim, where it
 * silently belongs to no day at all. It never appears on a service sheet and
 * the guest is never seated.
 *
 * The round-trip through Date is what catches 31 February, which passes any
 * regular expression you care to write and does not exist.
 */
export function checkDate(raw: string | null | undefined): Check {
  const v = String(raw ?? "").trim();
  if (!v) return { ok: false, error: "Choose a date." };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return { ok: false, error: "Use the date picker — the date isn't in a form we can read." };
  const d = new Date(`${v}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return { ok: false, error: "That isn't a real date." };
  if (d.toISOString().slice(0, 10) !== v) return { ok: false, error: `${v} isn't a real date.` };
  const year = Number(v.slice(0, 4));
  if (year < 2020 || year > 2100) return { ok: false, error: "That year looks wrong — check the date." };
  return { ok: true, value: v };
}

/** "HH:MM" on a 24-hour clock. "99:99" was accepted and stored. */
export function checkTime(raw: string | null | undefined): Check {
  const v = String(raw ?? "").trim();
  if (!v) return { ok: false, error: "Choose a time." };
  const m = /^(\d{1,2}):(\d{2})$/.exec(v);
  if (!m) return { ok: false, error: "Enter the time as HH:MM, like 19:30." };
  const h = Number(m[1]), min = Number(m[2]);
  if (h > 23 || min > 59) return { ok: false, error: "That isn't a time — hours go to 23, minutes to 59." };
  return { ok: true, value: `${String(h).padStart(2, "0")}:${m[2]}` };
}

/** Today in London, as "YYYY-MM-DD". Bookings are a UK business; the server's
 *  clock is UTC, and between midnight and 1am BST those are different days. */
export function todayInLondon(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Europe/London" });
}

export type NumberCheck = { ok: true; value: number } | { ok: false; error: string };

/**
 * A party size a restaurant could seat.
 *
 * `Number(formData.get("partySize"))` accepted -5, 100000 and 2.5. A negative
 * party is meaningless; a hundred thousand covers is a typo that would sit at
 * the top of the day's list looking like a catastrophe; a fractional one is a
 * half a person. The upper bound is generous on purpose — the largest private
 * room seats far fewer, but a provisional whole-restaurant buyout is a real
 * thing a manager types in.
 */
export function checkPartySize(raw: FormDataEntryValue | string | null | undefined, max = 300): NumberCheck {
  const s = String(raw ?? "").trim();
  if (!s) return { ok: false, error: "Enter how many people are coming." };
  if (!/^\d+$/.test(s)) return { ok: false, error: "Enter the number of guests as a whole number." };
  const n = Number(s);
  if (n < 1) return { ok: false, error: "A booking needs at least one guest." };
  if (n > max) return { ok: false, error: `${n} guests is more than we can seat — check the number.` };
  return { ok: true, value: n };
}
