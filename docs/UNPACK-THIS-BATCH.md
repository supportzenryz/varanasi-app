# Unpacking, on Windows, in Git Bash

Windows ships `tar`, which reads zips, so nothing needs installing:

```bash
cd ~/Downloads/varanasi-app

tar -xf ../security-hardening.zip
tar -xf ../admin-ux-and-vouchers.zip
tar -xf ../client-doc.zip
tar -xf ../windows-test-fixes.zip

# The type errors from `npm run build` are a stale node_modules, not the code:
# @types/node is not resolving, which is why TypeScript cannot find
# `node:sqlite` and thinks setInterval returns a plain number.
npm install

npm run db:migrate
rm -f .git/*.lock .git/refs/heads/*.lock

npm run build
npm run test:validate
npm run test:stripe
npm run test:money
npm run test:auth

git add -A
git commit -m "Security, admin feedback, gift vouchers, and a test suite that runs on Windows"
git push origin main
```

If `npm install` doesn't clear the type errors, the folder is properly stale:

```bash
rm -rf node_modules
npm install
```

## Two environment variables

`SESSION_SECRET` is now **required in production** — the site refuses to start
without it, rather than signing admin sessions with a string that is published
in this repository. Generate one:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Put it in **Railway → Variables**, and in `.env.local` for your own machine.

`PAYMENTS_SIMULATOR` is only for running the browser suite against a production
build, and must never be set on the live site:

```bash
PAYMENTS_SIMULATOR=i-understand-no-money-will-be-taken npm start
# then, in a second Git Bash window
npm run test:e2e
```

The admin's Payments tile says in plain words when the simulator is on.

## The browser suite runs on Windows now

It used to shell out to `python3` for every database read and every fixture —
nineteen times — so on a machine without Python it stopped at the first query.
It now uses Node's own SQLite and bcryptjs, both of which are already here.

Two things that conversion exposed, both of them real:

- **A read that raced a write.** The python subprocess took a couple of hundred
  milliseconds to start, which quietly covered the gap between the browser
  being redirected and the server finishing its write. Reading directly is fast
  enough to lose that race, and it looks exactly like a booking that was never
  created. The read is now a short poll. The suite is faster than it was.
- **`waitForURL` that waited for nothing.** Its pattern included `book-online`,
  which is the page the form is already on, so it matched instantly.

`npm run test:qr` still needs Python with OpenCV — it renders each gift-voucher
barcode to an image and reads it back with a real decoder, which is the only
way to prove a hand-written QR encoder is right. Leave that one to me.
