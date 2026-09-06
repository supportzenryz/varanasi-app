CREATE TABLE `room_images` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`room_id` integer NOT NULL,
	`src` text NOT NULL,
	`alt` text,
	`kind` text DEFAULT 'photo' NOT NULL,
	`heading_deg` integer DEFAULT 0 NOT NULL,
	`sort` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`room_id`) REFERENCES `private_rooms`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `room_images_room_idx` ON `room_images` (`room_id`);
