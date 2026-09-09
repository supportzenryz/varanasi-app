import path from "node:path";
import type { NextConfig } from "next";
import { redirects as oldUrlRedirects, feedRedirects } from "./src/lib/redirects";

const nextConfig: NextConfig = {
  // Every URL the old site had that the new one doesn't. Rankings move with a
  // 301; see src/lib/redirects.ts for why each one goes where it does.
  async redirects() {
    return [...oldUrlRedirects, ...feedRedirects];
  },
  // Next 16 only serves the quality levels declared here; anything else falls
  // back to 75 with a build warning. The homepage collage, the room cards and
  // the landing-page logo are served above the default deliberately.
  images: {
    qualities: [75, 88, 90, 95],
    // No custom loader. One was added to route the media library to a CDN,
    // but the photography turned out to be small enough to live in the repo
    // (21MB is what the site actually references), so there is nothing for a
    // CDN to solve — and a custom loader replaces Next's optimizer wholesale,
    // which meant local images were being served at full resolution. Next
    // warns about exactly this: a custom loader that ignores `width`.
    //
    // remotePatterns stays: if a CDN is ever wanted, putting absolute
    // Cloudinary URLs in the database is the simpler route and Next will
    // optimise them properly.
    remotePatterns: [
      { protocol: "https", hostname: "res.cloudinary.com", pathname: "/**" },
    ],
  },
  turbopack: {
    // There is a stray package-lock.json in C:\Users\sathi, and without this
    // Turbopack walks up looking for the workspace root, finds it, and warns
    // that it would have to include the whole home directory. Pin the root.
    root: path.resolve(process.cwd()),
  },
  /* Security headers, on the platform the site actually runs on.
   *
   * These existed — in `netlify.toml`, whose own opening comment explains that
   * Netlify cannot host this app at all (read-only filesystem, and the
   * database is a file on disk). So the headers were configured for a
   * deployment that will never happen, and the live site on Railway had none
   * of them: no clickjacking protection, no MIME-sniffing protection, a
   * referrer policy of whatever the browser felt like, and no HSTS. Next
   * serves these itself, from here, wherever it is hosted.
   *
   * The Content-Security-Policy is the one worth reading closely. It is the
   * difference between "someone found a way to inject a script tag" and
   * "someone is reading our guests' details": with a policy in place, an
   * injected script has nowhere to load from and nowhere to send anything.
   *
   * `'unsafe-inline'` is present for styles and not for scripts. Tailwind and
   * Next both emit inline style attributes, which cannot be nonce'd without a
   * good deal of machinery, and an injected *style* is a defacement rather
   * than a data breach. Scripts are the ones that matter, and Next's own
   * inline bootstrap is why `'unsafe-inline'` appears in script-src too —
   * removing it needs a nonce threaded through every route, which is a
   * worthwhile follow-up and not a thing to get wrong quietly. Even as it
   * stands, `connect-src 'self'` means an injected script cannot post what it
   * reads anywhere, which is the half that protects the guests.
   */
  async headers() {
    const csp = [
      "default-src 'self'",
      // Stripe's hosted payment page is an external navigation, not a frame,
      // so nothing third-party needs to run here.
      "script-src 'self' 'unsafe-inline'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob: https://res.cloudinary.com",
      "media-src 'self' https://res.cloudinary.com",
      "font-src 'self' data:",
      // Where the browser may send data. The important line.
      "connect-src 'self' https://api.stripe.com",
      "form-action 'self'",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "object-src 'none'",
      "upgrade-insecure-requests",
    ].join("; ");

    const common = [
      { key: "Content-Security-Policy", value: csp },
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "X-Frame-Options", value: "DENY" },
      { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
      // Nothing on this site needs a camera, a microphone or a location.
      { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
      // Two years, subdomains included. Only meaningful over HTTPS, which
      // Railway terminates, and harmless in development where it never fires.
      { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
    ];

    return [
      { source: "/:path*", headers: common },
      {
        // The admin is nobody's search result and nobody's cached page. A
        // manager's browser holding a page of guest details after they sign
        // out, on a shared iPad at the pass, is the case this covers.
        source: "/admin/:path*",
        headers: [
          ...common,
          { key: "X-Robots-Tag", value: "noindex, nofollow, noarchive" },
          { key: "Cache-Control", value: "no-store, max-age=0" },
        ],
      },
    ];
  },
  // `next dev` refuses cross-origin requests to its HMR endpoint by default,
  // which means the LAN address it prints doesn't actually work. Allow the
  // private ranges a phone or another machine on the office wifi would use.
  allowedDevOrigins: ["192.168.0.0/16", "10.0.0.0/8", "172.16.0.0/12"],
};

export default nextConfig;
