import { asc } from "drizzle-orm";
import { db } from "@/db";
import { branches } from "@/db/schema";
import { requireAbility } from "@/lib/auth";
import { bookingRules, prettyTime } from "@/lib/booking-config";
import { stripeConfigured } from "@/lib/stripe";
import { mailMode } from "@/lib/email";
import { saveBookingRules } from "./actions";

export const metadata = { title: "Settings" };

const field = "w-full border border-[--line] bg-white px-3 py-2 text-sm outline-none focus:border-gold";
const label = "block text-xs font-semibold text-ink-3 mb-1";
const pounds = (p: number) => (p / 100).toFixed(2).replace(/\.00$/, "");

export default async function SettingsAdmin() {
  await requireAbility("editSettings");
  const rules = bookingRules();
  const all = db.select().from(branches).orderBy(asc(branches.sort)).all();

  const stripeLive = stripeConfigured();
  const mail = mailMode();

  return (
    <>
      <span className="accent text-xs text-gold-ink">Settings</span>
      <h1 className="text-3xl sm:text-4xl mt-3">Reservation rules</h1>
      <p className="text-ink-3 mt-2 max-w-[62ch]">
        These control what guests can book on the website. Changes take effect immediately.
      </p>

      {/* what's actually wired up right now */}
      <div className="mt-8 grid gap-px bg-[--line] sm:grid-cols-2 border border-[--line]">
        <div className="bg-pale p-5">
          <span className="accent text-[0.58rem] text-gold-ink">Payments</span>
          <p className="mt-2 text-sm">
            {stripeLive ? (
              <><strong>Stripe is connected.</strong> Guests pay on Stripe&rsquo;s own secure page.</>
            ) : (
              <>
                <strong>Stripe is not connected yet.</strong> The booking flow works end to end, but guests
                see a clearly-labelled simulator instead of a real payment page. Add{" "}
                <code className="text-xs">STRIPE_SECRET_KEY</code> and{" "}
                <code className="text-xs">STRIPE_WEBHOOK_SECRET</code> to go live.
              </>
            )}
          </p>
        </div>
        <div className="bg-pale p-5">
          <span className="accent text-[0.58rem] text-gold-ink">Email</span>
          <p className="mt-2 text-sm">
            {mail === "outbox" ? (
              <>
                <strong>No email provider connected.</strong> Every email is written to{" "}
                <code className="text-xs">data/outbox</code> so you can read exactly what guests would
                receive. Add <code className="text-xs">RESEND_API_KEY</code> to send for real.
              </>
            ) : (
              <>Sending live via <strong>{mail}</strong>.</>
            )}
          </p>
        </div>
      </div>

      <form action={saveBookingRules} className="mt-10 grid gap-10">
        {/* deposits */}
        <section>
          <h2 className="text-xl">Deposits</h2>
          <p className="text-sm text-ink-3 mt-1.5 max-w-[62ch]">
            Your published policy has always been a deposit on Friday, Saturday and Sunday only. It is
            currently set to take one on <strong>every</strong> booking — switch to
            &ldquo;Weekend nights only&rdquo; to go back to the published policy.
          </p>
          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label className={label} htmlFor="depositPolicy">When to take a deposit</label>
              <select id="depositPolicy" name="depositPolicy" defaultValue={rules.deposit.policy} className={field}>
                <option value="always">Every booking</option>
                <option value="nights">Weekend nights only ({rules.deposit.nights.join(", ")})</option>
                <option value="off">Never — no deposits</option>
              </select>
            </div>
            <div>
              <label className={label} htmlFor="perPerson">Deposit per person (£)</label>
              <input id="perPerson" name="perPerson" inputMode="decimal"
                defaultValue={pounds(rules.deposit.perPersonPence)} className={field} />
            </div>
            <div>
              <label className={label} htmlFor="minParty">Only for parties of at least</label>
              <input id="minParty" name="minParty" inputMode="numeric"
                defaultValue={rules.deposit.minParty} className={field} />
            </div>
            <div>
              <label className={label} htmlFor="holdMinutes">Hold the table for (minutes)</label>
              <input id="holdMinutes" name="holdMinutes" inputMode="numeric"
                defaultValue={rules.deposit.holdMinutes} className={field} />
              <span className="block text-xs text-ink-3 mt-1">
                How long a guest has to pay before the time goes back on sale.
              </span>
            </div>
            <div>
              <label className={label} htmlFor="depositNote">Note shown to guests</label>
              <input id="depositNote" name="depositNote" defaultValue={rules.deposit.note} className={field} />
            </div>
          </div>
        </section>

        {/* sittings */}
        <section>
          <h2 className="text-xl">Sittings and capacity</h2>
          <p className="text-sm text-ink-3 mt-1.5 max-w-[62ch]">
            Currently offering {prettyTime(rules.slots.first)} to {prettyTime(rules.slots.last)}, every{" "}
            {rules.slots.intervalMinutes} minutes.
          </p>
          <div className="mt-5 grid gap-4 sm:grid-cols-3">
            <div>
              <label className={label} htmlFor="first">First sitting</label>
              <input id="first" name="first" type="time" defaultValue={rules.slots.first} className={field} />
            </div>
            <div>
              <label className={label} htmlFor="last">Last sitting</label>
              <input id="last" name="last" type="time" defaultValue={rules.slots.last} className={field} />
            </div>
            <div>
              <label className={label} htmlFor="interval">Every (minutes)</label>
              <input id="interval" name="interval" inputMode="numeric"
                defaultValue={rules.slots.intervalMinutes} className={field} />
            </div>

            {all.map((b) => (
              <div key={b.id}>
                <label className={label} htmlFor={`covers_${b.slug}`}>{b.city} — covers per sitting</label>
                <input id={`covers_${b.slug}`} name={`covers_${b.slug}`} inputMode="numeric"
                  defaultValue={rules.capacity.coversPerSlot[b.slug] ?? 30} className={field} />
              </div>
            ))}

            <div>
              <label className={label} htmlFor="maxParty">Largest party online</label>
              <input id="maxParty" name="maxParty" inputMode="numeric"
                defaultValue={rules.capacity.maxPartyOnline} className={field} />
              <span className="block text-xs text-ink-3 mt-1">Above this, guests are asked to call.</span>
            </div>
          </div>
        </section>

        {/* timing */}
        <section>
          <h2 className="text-xl">How far ahead</h2>
          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            <div>
              <label className={label} htmlFor="leadMinutes">Close bookings this many minutes before a sitting</label>
              <input id="leadMinutes" name="leadMinutes" inputMode="numeric"
                defaultValue={rules.leadTime.minutesBefore} className={field} />
            </div>
            <div>
              <label className={label} htmlFor="maxDays">Take bookings up to this many days ahead</label>
              <input id="maxDays" name="maxDays" inputMode="numeric"
                defaultValue={rules.leadTime.maxDaysAhead} className={field} />
            </div>
          </div>
        </section>

        {/* occasions + notifications */}
        <section>
          <h2 className="text-xl">Occasions and alerts</h2>
          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            <div>
              <label className={label} htmlFor="occasions">Occasion dropdown</label>
              <textarea id="occasions" name="occasions" rows={7}
                defaultValue={rules.occasions.options.join("\n")} className={field} />
              <span className="block text-xs text-ink-3 mt-1">One per line, in the order guests see them.</span>
            </div>
            <div>
              <label className={label} htmlFor="notifyTo">Email new bookings to</label>
              <textarea id="notifyTo" name="notifyTo" rows={7}
                defaultValue={rules.notifications.to.join("\n")} className={field} />
              <span className="block text-xs text-ink-3 mt-1">
                One address per line. Set to the branch reservations inboxes before launch.
              </span>
            </div>
          </div>
        </section>

        <button className="bg-ink text-pale px-6 py-3 text-sm font-semibold justify-self-start">
          Save reservation rules
        </button>
      </form>
    </>
  );
}
