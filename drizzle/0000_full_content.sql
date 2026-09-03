CREATE TABLE `audit_log` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer,
	`action` text NOT NULL,
	`entity` text NOT NULL,
	`entity_id` text,
	`detail` text,
	`created_at` integer DEFAULT (strftime('%s','now')) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `audit_log_created_idx` ON `audit_log` (`created_at`);--> statement-breakpoint
CREATE TABLE `blocked_dates` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`branch_id` integer NOT NULL,
	`date` text NOT NULL,
	`all_day` integer DEFAULT true NOT NULL,
	`from_time` text,
	`to_time` text,
	`room_id` integer,
	`reason` text,
	`created_at` integer DEFAULT (strftime('%s','now')) NOT NULL,
	FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`room_id`) REFERENCES `private_rooms`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `blocked_dates_branch_date_idx` ON `blocked_dates` (`branch_id`,`date`);--> statement-breakpoint
CREATE TABLE `bookings` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`reference` text NOT NULL,
	`branch_id` integer NOT NULL,
	`guest_name` text NOT NULL,
	`email` text,
	`phone` text,
	`party_size` integer NOT NULL,
	`date` text NOT NULL,
	`time` text NOT NULL,
	`room_id` integer,
	`occasion` text,
	`dietary` text,
	`notes` text,
	`status` text DEFAULT 'confirmed' NOT NULL,
	`deposit_pence` integer,
	`deposit_status` text DEFAULT 'none' NOT NULL,
	`stripe_payment_intent` text,
	`source` text DEFAULT 'website' NOT NULL,
	`created_at` integer DEFAULT (strftime('%s','now')) NOT NULL,
	FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`room_id`) REFERENCES `private_rooms`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `bookings_reference_idx` ON `bookings` (`reference`);--> statement-breakpoint
CREATE INDEX `bookings_branch_date_idx` ON `bookings` (`branch_id`,`date`);--> statement-breakpoint
CREATE TABLE `branch_stats` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`branch_id` integer NOT NULL,
	`value` text NOT NULL,
	`label` text NOT NULL,
	`image` text,
	`href` text,
	`sort` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `branch_stats_branch_idx` ON `branch_stats` (`branch_id`);--> statement-breakpoint
CREATE TABLE `branches` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`slug` text NOT NULL,
	`name` text NOT NULL,
	`city` text NOT NULL,
	`address_line` text NOT NULL,
	`postcode` text NOT NULL,
	`phone` text NOT NULL,
	`email` text,
	`maps_url` text,
	`opening_hours` text,
	`opening_note` text,
	`hero_image` text,
	`hero_video` text,
	`hero_kicker` text,
	`hero_heading` text,
	`intro` text,
	`about_heading` text,
	`about_subheading` text,
	`about_body` text,
	`drinks_pdf` text,
	`booking_email` text,
	`press_email` text,
	`is_published` integer DEFAULT true NOT NULL,
	`sort` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `branches_slug_idx` ON `branches` (`slug`);--> statement-breakpoint
CREATE TABLE `enquiries` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`branch_id` integer,
	`type` text NOT NULL,
	`name` text NOT NULL,
	`email` text,
	`phone` text,
	`company` text,
	`party_size` integer,
	`requested_date` text,
	`requested_time` text,
	`occasion` text,
	`room_id` integer,
	`dietary` text,
	`message` text,
	`marketing_consent` integer DEFAULT false NOT NULL,
	`terms_accepted_at` integer,
	`status` text DEFAULT 'new' NOT NULL,
	`handled_by_user_id` integer,
	`internal_note` text,
	`created_at` integer DEFAULT (strftime('%s','now')) NOT NULL,
	FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`room_id`) REFERENCES `private_rooms`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`handled_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `enquiries_branch_idx` ON `enquiries` (`branch_id`);--> statement-breakpoint
CREATE INDEX `enquiries_status_idx` ON `enquiries` (`status`);--> statement-breakpoint
CREATE TABLE `gallery_images` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`branch_id` integer NOT NULL,
	`src` text NOT NULL,
	`alt` text,
	`is_featured` integer DEFAULT false NOT NULL,
	`sort` integer DEFAULT 0 NOT NULL,
	`is_published` integer DEFAULT true NOT NULL,
	FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `gallery_images_branch_idx` ON `gallery_images` (`branch_id`);--> statement-breakpoint
CREATE TABLE `menu_categories` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`branch_id` integer NOT NULL,
	`name` text NOT NULL,
	`slug` text NOT NULL,
	`kind` text DEFAULT 'food' NOT NULL,
	`description` text,
	`note` text,
	`image` text,
	`price_pence` integer,
	`sort` integer DEFAULT 0 NOT NULL,
	`is_published` integer DEFAULT true NOT NULL,
	FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `menu_categories_branch_idx` ON `menu_categories` (`branch_id`);--> statement-breakpoint
CREATE TABLE `menu_items` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`category_id` integer NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`price_pence` integer,
	`measure` text,
	`price_pence_2` integer,
	`measure_2` text,
	`meta` text,
	`dietary` text,
	`is_signature` integer DEFAULT false NOT NULL,
	`is_published` integer DEFAULT true NOT NULL,
	`sort` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`category_id`) REFERENCES `menu_categories`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `menu_items_category_idx` ON `menu_items` (`category_id`);--> statement-breakpoint
CREATE TABLE `private_rooms` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`branch_id` integer NOT NULL,
	`name` text NOT NULL,
	`slug` text NOT NULL,
	`headline` text,
	`description` text,
	`tagline` text,
	`capacity_min` integer,
	`capacity_max` integer,
	`deposit_per_person_pence` integer,
	`hire_charge_pence` integer,
	`exclusivity_note` text,
	`set_menu_note` text,
	`ideal_for` text,
	`min_spend_pence` integer,
	`image` text,
	`image_blurred` text,
	`sort` integer DEFAULT 0 NOT NULL,
	`is_published` integer DEFAULT true NOT NULL,
	FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `private_rooms_branch_idx` ON `private_rooms` (`branch_id`);--> statement-breakpoint
CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text,
	`updated_at` integer DEFAULT (strftime('%s','now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`email` text NOT NULL,
	`password_hash` text NOT NULL,
	`name` text NOT NULL,
	`role` text DEFAULT 'staff' NOT NULL,
	`branch_id` integer,
	`is_active` integer DEFAULT true NOT NULL,
	`must_change_password` integer DEFAULT false NOT NULL,
	`last_login_at` integer,
	`created_at` integer DEFAULT (strftime('%s','now')) NOT NULL,
	FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_idx` ON `users` (`email`);--> statement-breakpoint
CREATE TABLE `voucher_redemptions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`voucher_id` integer NOT NULL,
	`amount_pence` integer NOT NULL,
	`balance_after_pence` integer NOT NULL,
	`branch_id` integer,
	`redeemed_by_user_id` integer,
	`note` text,
	`created_at` integer DEFAULT (strftime('%s','now')) NOT NULL,
	FOREIGN KEY (`voucher_id`) REFERENCES `vouchers`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`redeemed_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `voucher_redemptions_voucher_idx` ON `voucher_redemptions` (`voucher_id`);--> statement-breakpoint
CREATE TABLE `vouchers` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`code` text NOT NULL,
	`value_pence` integer NOT NULL,
	`balance_pence` integer NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`purchaser_name` text,
	`purchaser_email` text,
	`recipient_name` text,
	`recipient_email` text,
	`message` text,
	`branch_id` integer,
	`stripe_session_id` text,
	`stripe_payment_intent` text,
	`issued_at` integer,
	`expires_at` integer,
	`created_at` integer DEFAULT (strftime('%s','now')) NOT NULL,
	FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `vouchers_code_idx` ON `vouchers` (`code`);--> statement-breakpoint
CREATE INDEX `vouchers_status_idx` ON `vouchers` (`status`);