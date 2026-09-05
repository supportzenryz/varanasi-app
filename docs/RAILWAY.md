# Deploying to Railway

Four settings and one upload. Everything else is already in the repository.

---

## 1. Build command

```
npm run db:migrate && npm run db:seed && npm run build
```

Leave this exactly as it is. The build needs a populated database because the
branch pages are pre-rendered, and `generateStaticParams()` reads the branches
out of it — that is what "no such table: branches" was about on the first
attempt.

## 2. Start command

```
npm run start
```

This already runs `scripts/ensure-db.mjs` first, and that script is the whole
reason the site survives a second deploy. See §5 if you want to know why.

## 3. Volume

| Setting    | Value   |
| ---------- | ------- |
| Mount path | `/data` |

Not `/app/data`. Mounting over `/app/data` hides the database the build just
created inside the image, and the container comes up against an empty folder.

## 4. Variables

| Variable                            | Value                        | Needed |
| ----------------------------------- | ---------------------------- | ------ |
| `DATABASE_URL`                      | `/data/varanasi.db`          | yes    |
| `SITE_URL`                          | your Railway URL             | yes    |
| `SESSION_SECRET`                    | see below                    | yes    |
| `NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME` | `qu72ymeo`                   | images |
| `NEXT_PUBLIC_CLOUDINARY_FOLDER`     | leave empty (see §6)         | images |
| `STRIPE_SECRET_KEY`                 | `sk_test_…` to begin with    | later  |
| `STRIPE_WEBHOOK_SECRET`             | `whsec_…`                    | later  |

Generate the session secret once and keep it — changing it signs everyone out:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Stripe can wait. Without those two keys the booking flow still runs end to end
through a clearly-labelled payment simulator, so the site is demonstrable to
the client before the Stripe account clears verification.

## 5. Why the start command matters

The seed script opens with `delete from menu_items; delete from users; …`.
That is correct for a first install and destructive on every deploy after it —
the client's menu edits, their staff's changed passwords and their settings
would all revert to the shipped defaults each time anyone pushed.

`ensure-db.mjs` therefore runs migrations every time (they are additive, and a
schema change has to reach the live database) but seeds **only when the
database has no branches in it**. Verified both ways: a first boot seeds, and a
redeploy over edited data leaves the edits alone.

## 6. If images are still broken

The photography is served from Cloudinary, and the only thing that can be wrong
is which folder it landed in. Open any image in the Cloudinary media library
and look at its URL:

- `…/image/upload/v1234/birmingham/2024/07/logo.png`
  → leave `NEXT_PUBLIC_CLOUDINARY_FOLDER` empty.
- `…/image/upload/v1234/media/lib/birmingham/2024/07/logo.png`
  → set it to `media/lib`.

Change the variable and redeploy. Nothing else moves: the database stores
`/media/lib/…` paths and the CDN is applied when the page renders, so this is
never a data migration.

Clearing the variable entirely serves every image from `public/` instead, which
is how the test suite runs.

---

## Checking it worked

```
/                      location chooser
/birmingham            homepage, photographs present
/birmingham/menu       menu read from the database
/birmingham/catering   submit the form — it must return to /birmingham/catering
/admin/login           owner@varanasi.co.uk  /  ChangeMe!2026
```

Change that password on first sign-in; the admin will keep asking until you do.

Against a deployed URL the full suite runs with:

```bash
BASE_URL=https://your-app.up.railway.app npm run test:e2e
```
