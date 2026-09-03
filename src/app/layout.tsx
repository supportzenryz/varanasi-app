import type { Metadata } from "next";

export const metadata: Metadata = {
  title: { default: "Varanasi | Indian Fine Dining", template: "%s | Varanasi" },
  description: "Indian fine dining in Birmingham and Leicester.",
  metadataBase: new URL(process.env.SITE_URL ?? "https://varanasi.uk"),
  // Varanasi's own mark, copied out of the media library into public/brand so
  // the icons don't depend on the media import having been run.
  icons: {
    icon: [{ url: "/brand/favicon.svg", type: "image/svg+xml" }],
    apple: [{ url: "/brand/apple-touch-icon.png" }],
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-GB" suppressHydrationWarning>
      <body className="min-h-dvh antialiased" suppressHydrationWarning>
        {children}
      </body>
    </html>
  );
}
