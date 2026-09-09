/**
 * What counts as an acceptable password. One copy, used everywhere.
 *
 * There were two sets of rules, and the weaker one guarded the front door.
 * The change-password form in the admin asked for ten characters of anything;
 * the terminal tool asked for twelve with mixed case and a digit and refused
 * the obvious words. So the whole staff-onboarding design — new accounts start
 * on a shared password and `mustChangePassword` forces a change at first
 * sign-in — could be satisfied by typing that same shared password a second
 * time, since `ChangeMe!2026` is thirteen characters long. Every new account
 * could stay for ever on a password that is published in this repository.
 *
 * Plain JavaScript on purpose. The rules have to be identical in the Next
 * application (TypeScript, bundled) and in `scripts/set-password.mjs` (plain
 * `node`, no build step, has to work when nothing else does — it is the
 * recovery tool). A `.mjs` module with JSDoc types is the one thing both can
 * import without a toolchain in between, and two copies of a security rule is
 * how you get one that has quietly drifted.
 *
 * The bar is deliberately about length and predictability rather than
 * punctuation gymnastics: NCSC guidance, and everyone else's since, is that
 * forcing a symbol produces `Password1!` while length produces something
 * genuinely hard to guess. Twelve is the floor because these accounts can read
 * every guest's phone number and allergies and press the refund button.
 */

/** The password a new or reset account starts on. Never a working password. */
export const STARTING_STAFF_PASSWORD = "ChangeMe!2026";

export const MIN_LENGTH = 12;

/**
 * bcrypt work factor. Also shared, for the same reason: the recovery script
 * and the application must not hash at different strengths, or which door you
 * came in by decides how well your password is stored.
 *
 * 10 was the old value everywhere. Each step doubles the work an attacker has
 * to do per guess against a stolen database, and costs one sign-in about
 * 100ms — a trade worth making once, in 2026, rather than after a breach.
 */
export const BCRYPT_COST = 12;

/** Words that make a password guessable in this particular business. */
const OBVIOUS = [
  "changeme", "password", "varanasi", "letmein", "welcome", "admin",
  "birmingham", "leicester", "restaurant", "qwerty", "12345678",
];

/**
 * Why this password will not do, or null if it is fine.
 *
 * @param {string} password
 * @param {{ email?: string | null, name?: string | null, previous?: string | null }} [who]
 *   Anything known about the account, so the check can refuse a password built
 *   out of it. `previous` is the password being replaced, when the caller has
 *   it in hand.
 * @returns {string | null} a sentence to show the person, or null
 */
export function passwordComplaint(password, who = {}) {
  const pw = String(password ?? "");

  if (pw.length < MIN_LENGTH) {
    return `Please use at least ${MIN_LENGTH} characters. Three or four unrelated words are `
      + `easy to remember and hard to guess — "copper-lantern-tuesday" is far stronger than `
      + `"Varanasi1!".`;
  }
  if (pw.length > 200) {
    return "That is longer than 200 characters, which is almost always a paste that went wrong.";
  }
  if (pw !== pw.trim()) {
    return "It starts or ends with a space. That is nearly always a paste that picked one up, "
      + "and it will be the reason you can't sign in tomorrow.";
  }
  if (!/[a-z]/.test(pw) || !/[A-Z]/.test(pw)) {
    return "Please use both capital and small letters.";
  }
  if (!/[0-9]/.test(pw)) {
    return "Please include at least one number.";
  }

  const lower = pw.toLowerCase();

  /* The important one. Without this, the forced first-time change can be
     satisfied by re-entering the starting password. */
  if (lower === STARTING_STAFF_PASSWORD.toLowerCase()) {
    return "That is the starting password every new account is given, so it is the first thing "
      + "anyone would try. Please choose something only you know.";
  }
  if (who.previous && pw === who.previous) {
    return "That is the password you are already using. Please choose a different one.";
  }

  const hit = OBVIOUS.find((word) => lower.includes(word));
  if (hit) {
    return `Please don't build it around "${hit}" — it is one of the first things anyone `
      + `guessing at this restaurant's system would type.`;
  }

  /* A password containing the account's own name or address is a password an
     attacker already has most of. Only parts of four characters or more, so a
     three-letter name does not rule out half the dictionary. */
  const parts = [
    ...(who.email ? String(who.email).split(/[@._+-]/) : []),
    ...(who.name ? String(who.name).split(/\s+/) : []),
  ].map((p) => p.toLowerCase()).filter((p) => p.length >= 4);
  const personal = parts.find((p) => lower.includes(p));
  if (personal) {
    return `Please don't include "${personal}" — anyone guessing at your account already knows `
      + `your name and email address.`;
  }

  /* Long but barely varied. Every rule above is satisfied by
     "aaaaaaaaaaaaA1": twelve characters, mixed case, a digit — and three
     distinct characters in total, so a guesser has almost nothing to search.
     The first version of this test asked whether the *whole* string was one
     repeated character, which that password sails past. Counting distinct
     characters is the question actually worth asking. */
  if (new Set(pw).size < 5) {
    return "That uses too few different characters to be hard to guess, however long it is. "
      + "Try a few unrelated words instead.";
  }
  if (/(0123456789|abcdefghij|qwertyuiop)/.test(lower)) {
    return "That is a straight run along the keyboard. Please use something else.";
  }

  return null;
}
