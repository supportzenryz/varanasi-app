# Varanasi Restaurant - Full-Stack Web Application

A modern, full-featured restaurant management and booking system for Varanasi, with separate sites for Birmingham and Leicester locations.

## ⚡ Quick Start

```bash
npm install
npm run dev
# Visit http://localhost:3000/birmingham
```

**Admin login**: `owner@varanasi.uk` / `ChangeMe!2026`

## Features

### Public Website
- Branch-specific websites for Birmingham and Leicester
- Dynamic menu management (food, drinks, set menus)
- Online table booking with real-time availability
- Gift vouchers (purchase and redemption)
- Private dining room browsing
- Customer enquiry forms (contact, catering, corporate, franchise)
- Venue gallery with stat tiles
- Dark/gold theme, fully responsive

### Admin Dashboard
- Menu and drink management per branch
- Room and pricing management
- Reservation tracking with deposits
- Enquiries inbox with status tracking
- Gift voucher management
- Staff access control (Owner/Manager/Staff)
- Gallery and venue tiles management
- Complete audit logging
- Settings and configuration

### Integrations
- **Stripe**: Real-time payment processing
- **Email**: Resend or webhook-based email
- **WhatsApp**: Optional booking notifications
- **Analytics**: GA4 with consent gate
- **Audit trail**: Complete action history

## Tech Stack

- Next.js 15+ (React, Server Components)
- Tailwind CSS (dark/light theme)
- SQLite/PostgreSQL with Drizzle ORM
- Server actions + client validation
- Playwright E2E tests
- Netlify deployment ready

## Project Structure

```
src/
  ├── app/(site)/         # Public website
  ├── app/(dash)/         # Admin dashboard
  ├── app/(auth)/         # Authentication
  ├── components/         # React components
  ├── lib/               # Utilities
  └── db/                # Database schema
data/
  ├── varanasi.db        # SQLite database
  ├── legal.json         # Privacy & terms
  └── booking.json       # Booking rules
```

## Environment Variables

Required:
- `SITE_URL`: Your domain
- `SESSION_SECRET`: Random 32-byte hex
- `DATABASE_URL`: SQLite or PostgreSQL

Optional:
- `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`
- `RESEND_API_KEY`, `MAIL_WEBHOOK_URL`
- `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_ID`

## Admin Permissions

| Action | Owner | Manager | Staff |
|--------|-------|---------|-------|
| Edit menu | ✓ | ✓ | — |
| Edit rooms | ✓ | ✓ | — |
| Manage staff | ✓ | — | — |
| View enquiries | ✓ | ✓ | — |
| View bookings | ✓ | ✓ | ✓ |

## Development

```bash
npm run dev          # Start dev server
npm run build        # Production build
npm run test         # Run E2E tests
npm run db:studio    # Browse data
npm run type-check   # Check types
```

## Deployment

See [docs/DEPLOYMENT.md](./docs/DEPLOYMENT.md) for complete Netlify setup, including:
- Environment variable configuration
- Stripe webhook setup
- Email configuration
- Database initialization
- SSL/HTTPS setup
- Custom domain configuration
- Post-deployment testing

## Security

- ✓ CSRF protection
- ✓ Server-side validation
- ✓ Parameterized queries
- ✓ Audit logging
- ✓ GDPR consent tracking
- ✓ Branch-level access control

## Performance

- Server-side rendering
- Optimized images
- Static site generation
- Database query optimization
- CSS-in-JS for interactivity

## Troubleshooting

### Build Fails
- Check Node version matches local
- Run `npm run build` locally
- Review Netlify build logs

### Bookings Not Processing
- Verify Stripe keys (test vs. live)
- Check webhook in Stripe dashboard
- Review `data/outbox/` logs

### Emails Not Sending
- Verify RESEND_API_KEY
- Check email domain verified
- Review Resend dashboard

See [docs/DEPLOYMENT.md](./docs/DEPLOYMENT.md) for detailed troubleshooting.

## Support

For issues or questions:
1. Check docs/DEPLOYMENT.md troubleshooting
2. Review admin audit log
3. Check Netlify build logs
4. Review browser console errors
5. Contact with: Site URL, error message, reproduction steps

## License

Copyright © 2026 Varanasi Restaurant. All rights reserved.
