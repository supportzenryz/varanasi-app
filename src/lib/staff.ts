/**
 * The password a new or reset staff account starts on.
 *
 * It is deliberately shared and deliberately weak, because it is never a
 * working password: `mustChangePassword` is set alongside it, and
 * `requireAbility` sends anyone holding it to the change-password page and
 * nowhere else. Kept here rather than in the server-action file because a
 * "use server" module may only export async functions.
 */
export const STARTING_STAFF_PASSWORD = "ChangeMe!2026";
