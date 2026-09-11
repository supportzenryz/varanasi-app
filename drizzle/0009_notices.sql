-- The "it saved" / "it didn't, because…" message, held server-side.
--
-- It used to travel in the query string, so a redirect after issuing a gift
-- voucher produced a URL containing the voucher code and the recipient's email
-- address. A voucher code is bearer money and a URL is written into browser
-- history on a shared restaurant terminal and into every access log in the
-- path. Now the URL carries six random bytes and the text lives here.
--
-- Rows are swept on write rather than deleted on read: a flash message that
-- vanishes because React rendered the component twice is worse than one that
-- lingers for five minutes in a table nobody looks at.
CREATE TABLE `notices` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`message` text NOT NULL,
	-- What the screen was looking at, so it can be restored without putting it
	-- in the address bar. The gift-voucher screen keeps the looked-up code here.
	`context` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL
);
