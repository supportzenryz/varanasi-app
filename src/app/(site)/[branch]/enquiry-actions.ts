"use server";
import { redirect } from "next/navigation";
import { submitEnquiry, type EnquiryType } from "@/lib/enquiry";
import { rememberSubmission } from "@/lib/form-recall";

/**
 * One action behind every enquiry form on the site. Which page it came from is
 * carried in `type`, so the record says what the person was actually asking
 * about — a franchise enquiry and a table enquiry shouldn't land in one
 * undifferentiated pile, which is what the old email-only setup produced.
 */
/**
 * `returnTo` arrives in the form body, so it is attacker-controlled: left
 * unchecked, `returnTo=https://evil.example` would turn every enquiry form on
 * the site into an open redirect. Only a same-site absolute path is accepted —
 * one leading slash, no scheme, no protocol-relative `//host` — and anything
 * else falls back to the branch home.
 */
function safeReturn(raw: string, branchSlug: string | null): string {
  const fallback = branchSlug ? `/${branchSlug}` : "/";
  if (!raw.startsWith("/") || raw.startsWith("//")) return fallback;
  if (/[\r\n]|^\/\\/.test(raw)) return fallback;
  return raw.split("?")[0];
}

export async function submitEnquiryAction(formData: FormData) {
  const type = String(formData.get("type") ?? "contact") as EnquiryType;
  const branchSlug = String(formData.get("branch") ?? "") || null;
  const page = safeReturn(String(formData.get("returnTo") ?? ""), branchSlug);

  const partyRaw = String(formData.get("partySize") ?? "");
  const roomRaw = String(formData.get("roomId") ?? "");

  const result = await submitEnquiry({
    type,
    branchSlug,
    name: String(formData.get("name") ?? ""),
    email: String(formData.get("email") ?? ""),
    phone: String(formData.get("phone") ?? "") || null,
    company: String(formData.get("company") ?? "") || null,
    location: String(formData.get("location") ?? "") || null,
    message: String(formData.get("message") ?? "") || null,
    partySize: partyRaw ? Number(partyRaw) : null,
    requestedDate: String(formData.get("requestedDate") ?? "") || null,
    requestedTime: String(formData.get("requestedTime") ?? "") || null,
    occasion: String(formData.get("occasion") ?? "") || null,
    roomId: roomRaw ? Number(roomRaw) : null,
    dietary: String(formData.get("dietary") ?? "") || null,
    marketingConsent: formData.get("marketing") === "on",
    termsAccepted: formData.get("terms") === "on",
  });

  if (!result.ok) {
    /* The message and everything typed go into a short-lived, server-set
     * cookie rather than the query string. That returns the guest's work to
     * them instead of blanking the form, and it takes the message out of a
     * place anyone can write to: `?error=Your+card+was+declined…` used to
     * render verbatim inside the site's own error box on the real domain. */
    await rememberSubmission(result.error, formData, page);
    redirect(`${page}?error=1`);
  }
  redirect(`${page}?sent=1`);
}
