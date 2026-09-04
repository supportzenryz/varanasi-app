import { submitEnquiryAction } from "@/app/(site)/[branch]/enquiry-actions";
import { SubmitButton } from "@/components/SubmitButton";

export type EnquiryField =
  | "phone" | "company" | "location" | "partySize" | "date" | "time" | "occasion" | "room" | "dietary";

/**
 * The one enquiry form, configured per page.
 *
 * The old site had five near-identical YOOessentials forms, each emailing a
 * slightly different address with a slightly different field list and no
 * record kept anywhere. This is the same set of fields, driven by props, all
 * writing to one table — so nothing can be lost and every page's form behaves
 * identically.
 */
export function EnquiryForm({
  type, branchSlug, returnTo, fields = [], rooms = [], occasions = [], heading, intro,
  submitLabel = "Send enquiry",
  privacyHref, messageLabel = "Your message", messagePlaceholder,
  values = {},
}: {
  type: "booking" | "private_room" | "corporate" | "catering" | "contact" | "franchise";
  branchSlug: string | null;
  /** The path to return the sender to with `?sent=1`. Required, because the
   *  action's fallback is the contact page: without it a guest who filled in
   *  the catering form was answered on a different page entirely, and a
   *  franchise enquiry (which has no branch) landed on the location chooser. */
  returnTo: string;
  fields?: EnquiryField[];
  rooms?: { id: number; name: string }[];
  occasions?: string[];
  heading?: string;
  intro?: string;
  submitLabel?: string;
  privacyHref: string;
  messageLabel?: string;
  messagePlaceholder?: string;
  /** What the sender typed on a submission the server rejected, so a single
   *  mistyped character does not cost them the whole form. */
  values?: Record<string, string>;
}) {
  const has = (f: EnquiryField) => fields.includes(f);
  const field =
    "w-full border border-[--line] px-3.5 py-3 text-[0.95rem] outline-none focus:border-gold rounded-none";
  const label = "block accent text-[0.6rem] text-gold mb-2";
  /* Marked rather than left to guesswork. The asterisk is aria-hidden and
     paired with the real `required` attribute, so a screen reader hears the
     field's own requiredness rather than a stray star. */
  const Req = () => <span aria-hidden="true" className="text-gold/70 ml-0.5">*</span>;
  const Opt = () => <span className="text-pale/40 font-normal normal-case tracking-normal ml-1.5">(optional)</span>;

  return (
    <form action={submitEnquiryAction} className="grid gap-6">
      <input type="hidden" name="type" value={type} />
      <input type="hidden" name="branch" value={branchSlug ?? ""} />
      <input type="hidden" name="returnTo" value={returnTo} />

      {heading && <h2 className="text-2xl sm:text-3xl">{heading}</h2>}
      {intro && <p className="text-pale/70 max-w-[62ch] -mt-2">{intro}</p>}

      <p className="text-xs text-pale/50 -mt-2">Fields marked <span className="text-gold/70">*</span> are needed so we can reply.</p>

      <div className="grid gap-6 sm:grid-cols-2">
        <div>
          <label className={label} htmlFor={`${type}-name`}>Your name<Req /></label>
          <input id={`${type}-name`} name="name" required autoComplete="name" defaultValue={values.name ?? ""} className={field} />
        </div>
        <div>
          <label className={label} htmlFor={`${type}-email`}>Email<Req /></label>
          <input id={`${type}-email`} name="email" type="email" required autoComplete="email" defaultValue={values.email ?? ""} className={field} />
        </div>

        {has("phone") && (
          <div>
            <label className={label} htmlFor={`${type}-phone`}>Phone<Opt /></label>
            <input id={`${type}-phone`} name="phone" type="tel" autoComplete="tel" defaultValue={values.phone ?? ""} className={field} />
          </div>
        )}
        {has("company") && (
          <div>
            <label className={label} htmlFor={`${type}-company`}>Company<Opt /></label>
            <input id={`${type}-company`} name="company" defaultValue={values.company ?? ""} className={field} />
          </div>
        )}
        {has("location") && (
          <div>
            <label className={label} htmlFor={`${type}-location`}>Franchise location</label>
            <input id={`${type}-location`} name="location" placeholder="City or territory" defaultValue={values.location ?? ""} className={field} />
          </div>
        )}
        {has("partySize") && (
          <div>
            <label className={label} htmlFor={`${type}-party`}>Number of guests<Opt /></label>
            <input id={`${type}-party`} name="partySize" type="number" min={1} max={500} defaultValue={values.partySize ?? ""} className={field} />
          </div>
        )}
        {has("date") && (
          <div>
            <label className={label} htmlFor={`${type}-date`}>Preferred date<Opt /></label>
            <input id={`${type}-date`} name="requestedDate" type="date" min={new Date().toISOString().slice(0, 10)} defaultValue={values.requestedDate ?? ""} className={field} />
          </div>
        )}
        {has("time") && (
          <div>
            <label className={label} htmlFor={`${type}-time`}>Preferred time<Opt /></label>
            <input id={`${type}-time`} name="requestedTime" type="time" defaultValue={values.requestedTime ?? ""} className={field} />
          </div>
        )}
        {has("occasion") && occasions.length > 0 && (
          <div>
            <label className={label} htmlFor={`${type}-occasion`}>Occasion</label>
            <select id={`${type}-occasion`} name="occasion" defaultValue={values.occasion ?? occasions[0]} className={field}>
              {occasions.map((o) => <option key={o} value={o}>{o}</option>)}
            </select>
          </div>
        )}
        {has("room") && rooms.length > 0 && (
          <div>
            <label className={label} htmlFor={`${type}-room`}>Which room?</label>
            <select id={`${type}-room`} name="roomId" defaultValue={values.roomId ?? ""} className={field}>
              <option value="">Not sure — please advise</option>
              {rooms.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
          </div>
        )}
        {has("dietary") && (
          <div className="sm:col-span-2">
            <label className={label} htmlFor={`${type}-dietary`}>Dietary requirements<Opt /></label>
            <input id={`${type}-dietary`} name="dietary" placeholder="Allergies, vegetarian, vegan…" defaultValue={values.dietary ?? ""} className={field} />
          </div>
        )}

        <div className="sm:col-span-2">
          <label className={label} htmlFor={`${type}-message`}>{messageLabel}</label>
          <textarea id={`${type}-message`} name="message" rows={5} maxLength={4000}
            defaultValue={values.message ?? ""}
            placeholder={messagePlaceholder} className={field} />
        </div>
      </div>

      <div className="grid gap-3">
        <label className="flex gap-3 text-sm items-start">
          <input type="checkbox" name="terms" required className="mt-0.5 h-5 w-5 shrink-0 accent-[#c6a35a]" />
          <span>
            I&rsquo;m happy for Varanasi to hold these details in order to reply to me, as set out in the{" "}
            <a href={privacyHref} className="underline hover:text-gold">privacy policy</a>.
          </span>
        </label>
        <label className="flex gap-3 text-sm items-start">
          <input type="checkbox" name="marketing" className="mt-0.5 h-5 w-5 shrink-0 accent-[#c6a35a]" />
          <span>I&rsquo;d also like to hear about events, new menus and offers.</span>
        </label>
      </div>

      <SubmitButton className="btn btn-gold justify-self-start" pendingLabel="Sending…">
        {submitLabel}
      </SubmitButton>
    </form>
  );
}
