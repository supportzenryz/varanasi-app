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
    // Every <Image> resolves through src/lib/image-loader.js, which sends the
    // media library to Cloudinary and leaves everything in public/ alone. Doing
    // it in a loader rather than at each call site means the admin's own image
    // previews are covered too, and no page can be forgotten.
    loader: "custom",
    loaderFile: "./src/lib/image-loader.js",
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
