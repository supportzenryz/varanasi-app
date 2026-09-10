-- Who did it, when it wasn't a member of staff.
--
-- `audit_log.user_id` is null for anything a guest does, and null on its own
-- cannot say whether that was a guest booking a table or a scheduled job
-- expiring a voucher. `actor` carries the readable answer — "Emily Warner",
-- "scheduler", "Stripe" — and stays null for staff, whose name is already
-- reachable through user_id.
ALTER TABLE `audit_log` ADD `actor` text;

-- Everyone who has agreed to hear from the restaurant.
--
-- Deliberately its own table rather than a query across bookings and
-- enquiries. Consent is a fact with its own history: when it was given, on
-- which form, and — the part that matters if anyone ever asks — when it was
-- withdrawn. A boolean column on a booking cannot answer "prove she agreed",
-- and it cannot hold an unsubscribe from someone who has since had their
-- booking anonymised under Article 17.
CREATE TABLE `marketing_contacts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`email` text NOT NULL,
	`name` text,
	`branch_id` integer REFERENCES `branches`(`id`),
	-- "booking" | "enquiry" | "voucher" | "manual"
	`source` text NOT NULL,
	-- the exact wording they agreed to, kept verbatim
	`consent_text` text,
	`consented_at` integer NOT NULL,
	`consent_ip` text,
	-- set when they unsubscribe; the row is never deleted, so a later signup
	-- cannot quietly resurrect someone who asked to be left alone
	`unsubscribed_at` integer,
	`unsubscribe_token` text NOT NULL,
	`last_sent_at` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL
);
CREATE UNIQUE INDEX `marketing_contacts_email_idx` ON `marketing_contacts` (`email`);
CREATE UNIQUE INDEX `marketing_contacts_token_idx` ON `marketing_contacts` (`unsubscribe_token`);

-- One weekly email, from draft to sent.
CREATE TABLE `campaigns` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`subject` text NOT NULL,
	`preheader` text,
	`body` text NOT NULL,
	-- "draft" | "sending" | "sent" | "cancelled"
	`status` text DEFAULT 'draft' NOT NULL,
	-- null means both restaurants
	`branch_id` integer REFERENCES `branches`(`id`),
	-- the Monday this draft was prepared for, as YYYY-MM-DD, so the scheduler
	-- cannot prepare the same week twice
	`week_of` text,
	`prepared_by` text,
	`sent_by_user_id` integer REFERENCES `users`(`id`),
	`sent_at` integer,
	`recipient_count` integer DEFAULT 0 NOT NULL,
	`failed_count` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
CREATE UNIQUE INDEX `campaigns_week_idx` ON `campaigns` (`week_of`);
