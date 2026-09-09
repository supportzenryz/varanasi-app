/**
 * The password a new or reset staff account starts on.
 *
 * It is deliberately shared and deliberately weak, because it is never a
 * working password: `mustChangePassword` is set alongside it, and
 * `requireAbility` sends anyone holding it to the change-password page and
 * nowhere else. Kept out of the server-action file because a "use server"
 * module may only export async functions.
 *
 * The value itself lives in `password-rules.mjs`, beside the check that
 * refuses it as a new password. Two copies of this string is how "type the
 * starting password again" quietly becomes an acceptable answer to "choose a
 * new password".
 */
export { STARTING_STAFF_PASSWORD } from "./password-rules.mjs";
