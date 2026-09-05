# Backups

## What is backed up, and when

Everything the restaurant has recorded — bookings and their deposit state,
gift vouchers and their balances, redemptions, enquiries, menus, rooms, staff
accounts and the audit log. One file, taken **once a day**, automatically, by
the running site. Nothing to schedule and nothing to remember.

The last thirty are kept (`BACKUP_KEEP`), in `backups/` beside the database —
on the mounted volume, not inside the container, so a deploy does not erase
them.

Each backup is taken with SQLite's `VACUUM INTO`, not by copying the file. A
copy of a live database can catch it mid-write with an uncheckpointed
write-ahead log: the result is the right size, looks fine, and fails to open
on the day it is needed. Every backup is then reopened and its tables counted
before it is accepted, so a broken one is reported rather than trusted.

## What this protects you from — and what it does not

| | |
| --- | --- |
| **Covered** | a bad update, a mistaken bulk delete, corruption, a deploy that wipes the app, someone clearing data by hand |
| **Not covered** | losing the disk itself — the backups sit beside the database |

That second row is the reason for the next section. A backup that quietly
protects against less than you assume is worse than no backup, because you
stop worrying.

## Keeping a copy somewhere else

**Admin → Backups → Download.** Owner only. Do it monthly, and keep the file
somewhere separate — a laptop, cloud storage, anywhere not this server.

Gift vouchers are why this matters more than it looks. A guest pays £100 and
receives a code. This database is the only record that the debt exists. Lose
it with no offsite copy and there are customers holding valid claims that
nothing can verify — and no way to tell them apart from anyone who invents a
code.

## Restoring

1. Stop the service.
2. Put the backup where `DATABASE_URL` points, named `varanasi.db`.
3. Delete any `varanasi.db-wal` and `varanasi.db-shm` beside it — they belong
   to the database you are replacing and will corrupt the one you restore.
4. Start the service. Migrations run on start and are safe to re-run.

Worth doing once, deliberately, before you ever need it. An untested restore
is a guess.

## Settings

| Variable | Default | |
| --- | --- | --- |
| `BACKUP_KEEP` | `30` | how many to keep |
| `BACKUP_EVERY_HOURS` | `24` | how often |

The schedule checks hourly and backs up when the newest is older than the
interval, so restarts never reset the clock — a container that restarts
nightly still produces one backup a day, not none and not twelve.
