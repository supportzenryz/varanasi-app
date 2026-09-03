ALTER TABLE `bookings` ADD `follow_up_sent_at` integer;--> statement-breakpoint
ALTER TABLE `bookings` ADD `whatsapp_opt_in` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `vouchers` ADD `deliver_on` text;--> statement-breakpoint
ALTER TABLE `vouchers` ADD `delivered_at` integer;--> statement-breakpoint
ALTER TABLE `vouchers` ADD `origin` text DEFAULT 'purchase' NOT NULL;--> statement-breakpoint
ALTER TABLE `vouchers` ADD `booking_id` integer;