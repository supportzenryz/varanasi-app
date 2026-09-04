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
  // `next dev` refuses cross-origin requests to its HMR endpoint by default,
  // which means the LAN address it prints doesn't actually work. Allow the
  // private ranges a phone or another machine on the office wifi would use.
  allowedDevOrigins: ["192.168.0.0/16", "10.0.0.0/8", "172.16.0.0/12"],
};

export default nextConfig;
