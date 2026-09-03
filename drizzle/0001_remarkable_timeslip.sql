ALTER TABLE `bookings` ADD `stripe_session_id` text;--> statement-breakpoint
ALTER TABLE `bookings` ADD `deposit_paid_at` integer;--> statement-breakpoint
ALTER TABLE `bookings` ADD `hold_expires_at` integer;--> statement-breakpoint
ALTER TABLE `bookings` ADD `marketing_consent` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `bookings` ADD `terms_accepted_at` integer;--> statement-breakpoint
ALTER TABLE `bookings` ADD `cancel_token` text;