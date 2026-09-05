# Varanasi Restaurant - Deployment Guide

## Pre-Deployment Checklist

### Environment Variables (.env.local)
Before deploying, set these in your Netlify environment variables:

```env
# Essential
SITE_URL=https://yourdomain.com
SESSION_SECRET=<generate: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))">
DATABASE_URL=./data/varanasi.db

# Stripe (for real bookings)
STRIPE_SECRET_KEY=sk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...

# Email (recommended: Resend)
RESEND_API_KEY=...
MAIL_FROM=reservations@varanasi.uk

# WhatsApp notifications (optional)
WHATSAPP_TOKEN=...
WHATSAPP_PHONE_ID=...

# Analytics (optional)
# Set in admin dashboard instead
```

### Database Initialization
The app uses SQLite by default. On Netlify:

1. **Local SQLite**: Works fine for small-to-medium traffic
   - Database persists in `.data/varanasi.db`
   - Suitable up to launch

2. **Switch to PostgreSQL** (recommended for scale):
   - Change `DATABASE_URL` to Postgres connection string
   - Run migrations on your local machine first
   - Deploy with empty `.data/` (ignored in git)

### Content Verification

Before going live:
- [ ] Admin login works (owner@varanasi.uk / ChangeMe!2026)
- [ ] All menu items display with correct prices
- [ ] Private rooms list by branch correctly
- [ ] Gallery images load and display
- [ ] All enquiry forms submit successfully
- [ ] Gift vouchers can be purchased
- [ ] Email notifications test correctly (check data/outbox)
- [ ] Legal pages (privacy/terms) render correctly
- [ ] Contact and catering enquiry forms work

### Security Checks

- [ ] No API keys committed to git (check .gitignore)
- [ ] HTTPS enforced on production domain
- [ ] CSRF tokens on all forms (built-in)
- [ ] Consent enforcement (server-side validation)
- [ ] Audit logging enabled for all admin actions
- [ ] Session security configured
- [ ] Database backups scheduled

## Deployment to Netlify

### Step 1: Git Setup
```bash
git add .
git commit -m "Production deployment ready"
git push origin main
```

### Step 2: Connect to Netlify
1. Log in to [netlify.com](https://netlify.com)
2. Click "New site from Git"
3. Select your repository
4. Build settings:
   - Build command: `npm run build`
   - Publish directory: `.next`
   - Node version: 20.x (or matching your local)

### Step 3: Set Environment Variables
In Netlify dashboard > Site settings > Build & deploy > Environment:
```
SITE_URL=https://yourdomain.com
SESSION_SECRET=<your-generated-secret>
DATABASE_URL=./data/varanasi.db
STRIPE_SECRET_KEY=sk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...
RESEND_API_KEY=...
MAIL_FROM=reservations@varanasi.uk
```

### Step 4: Custom Domain
1. Go to Site settings > Domain management
2. Add your custom domain
3. Point DNS records:
   ```
   Type: ALIAS/CNAME
   Value: your-site.netlify.app
   ```

### Step 5: HTTPS & Security
- Netlify auto-generates SSL certificate
- Enable automatic HTTPS redirect in:
  - Site settings > Domain management > HTTPS
  - Disable HTTP (force HTTPS)

### Step 6: Stripe Webhook
1. Go to Stripe Dashboard > Developers > Webhooks
2. Add endpoint: `https://yourdomain.com/api/stripe/webhook`
3. Subscribe to:
   - `checkout.session.completed`
   - `checkout.session.async_payment_succeeded`
   - `checkout.session.async_payment_failed`
   - `checkout.session.expired`
4. Copy signing secret → set as `STRIPE_WEBHOOK_SECRET`

### Step 7: Email Setup (Resend)
1. Sign up at [resend.com](https://resend.com)
2. Verify your domain
3. Create API key
4. Set `RESEND_API_KEY` in environment variables

### Step 8: First Deployment
```bash
# In Netlify, your main branch auto-deploys
# Watch: Site overview > Production deploys
# Once deployed, test at https://yourdomain.com
```

## Post-Deployment Testing

### Live Site Checks
1. Visit `https://yourdomain.com/birmingham` and `https://yourdomain.com/leicester`
2. Check all navigation links work
3. Try booking a table (test payment)
4. Submit enquiry forms
5. Check admin login at `https://yourdomain.com/admin/login`

### Admin Configuration
1. Log in as owner (password will need changing on first login)
2. Update Settings:
   - GA4 measurement ID
   - Google review URLs per branch
3. Verify Gallery and Venue tiles display correctly
4. Test Staff access creation

### Email Testing
- Confirm booking emails arrive
- Verify enquiry notifications sent
- Check styling in email clients

## Monitoring & Maintenance

### Regular Checks
- [ ] Monitor Netlify build logs for failures
- [ ] Review admin audit log for suspicious activity
- [ ] Check Stripe dashboard for payment issues
- [ ] Monitor email delivery in Resend dashboard
- [ ] Backup database regularly

### Database Backups
For SQLite:
```bash
# Netlify Functions or scheduled cron job
cp data/varanasi.db backups/varanasi-$(date +%Y%m%d).db
```

For PostgreSQL:
```bash
pg_dump $DATABASE_URL | gzip > backups/varanasi-$(date +%Y%m%d).sql.gz
```

### Performance
- Monitor Netlify Analytics
- Use Google PageSpeed Insights
- Check database query performance
- Optimize images if needed

## Troubleshooting

### Deployment fails
- Check Node version matches local: `node --version`
- Verify environment variables are set
- Check build logs in Netlify dashboard
- Run `npm run build` locally to replicate

### Bookings not processing
- Verify Stripe keys are correct (live vs test)
- Check webhook is registered in Stripe dashboard
- Review `data/outbox` logs locally to test

### Emails not sending
- Verify RESEND_API_KEY is set
- Check email is from a verified domain
- Review Resend dashboard for delivery status
- Check spam folders

### Database issues
- SQLite: Use Netlify Functions to backup/restore
- PostgreSQL: Use standard pg_dump/pg_restore
- Keep `data/` directory in `.gitignore`

## Scaling

### When to upgrade
- Concurrent users > 100: Monitor database performance
- Bookings/day > 500: Consider PostgreSQL
- Data size > 1GB: Move to managed database service

### Migration to PostgreSQL
1. Test locally first with Postgres
2. Set new `DATABASE_URL` in Netlify
3. Run schema migration
4. Populate data from SQLite export
5. Verify all pages work
6. Update `.gitignore` to remove SQLite DB

## Support

For issues:
1. Check Netlify build logs
2. Review browser console errors
3. Check admin audit log
4. Review Stripe dashboard for payment issues
5. Contact support with:
   - Site URL
   - Error message
   - Steps to reproduce
   - Netlify build ID (if deployment issue)
