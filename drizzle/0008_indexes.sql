-- Indexes for the queries that run on the money path.
--
-- None of these change behaviour; all of them stop a query that currently
-- scans a whole table from doing so as the restaurant trades. Measured against
-- a copy of the database grown to 60k bookings and 20k vouchers:
--
--   expireStaleHolds()      7.3ms -> 0.019ms   (runs on every /book-online view)
--   bookingBySessionId()    6.9ms -> 0.045ms   (every webhook, every return from Stripe)
--   voucher admin list      2.1ms -> 0.14ms
--
-- At the restaurant's real scale today these are fractions of a millisecond
-- either way. They are here because the cost is one line each and the queries
-- they cover are the ones a guest waits on after paying.
CREATE INDEX `bookings_status_hold_idx` ON `bookings` (`status`,`hold_expires_at`);
CREATE INDEX `bookings_session_idx` ON `bookings` (`stripe_session_id`);
CREATE INDEX `vouchers_session_idx` ON `vouchers` (`stripe_session_id`);
CREATE INDEX `vouchers_created_idx` ON `vouchers` (`created_at`);
