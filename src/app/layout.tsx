import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import { THEME_SCRIPT } from "@/components/theme-script";
import "./globals.css";

// Every page is rendered per request so it can carry the per-request CSP script nonce set in src/proxy.ts.
// A statically pre-rendered page would have no nonce and all its scripts would be blocked.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  metadataBase: new URL(process.env.APP_URL ?? "http://localhost:3000"),
  title: { default: "KingsView Solutions", template: "%s · KingsView Solutions" },
  description: "Websites and software, branding, design and printing, CCTV, office supplies, photography, training, branded items and IT supplies in Ghana.",
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#18181b" },
  ],
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  return (
    // data-theme is set by THEME_SCRIPT before the first paint, so React must not treat it as a mismatch.
    <html lang="en-GH" data-theme="light" suppressHydrationWarning>
      <head>
        <script nonce={nonce} dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body className="min-h-screen font-sans antialiased">
        <a href="#main" className="skip-link">
          Skip to content
        </a>
        {children}
      </body>
    </html>
  );
}
