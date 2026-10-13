import type { Metadata } from "next";
import "./globals.css";

// Every page is rendered per request so it can carry the per-request CSP script nonce set in src/proxy.ts.
// A statically pre-rendered page would have no nonce and all its scripts would be blocked.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  metadataBase: new URL(process.env.APP_URL ?? "http://localhost:3000"),
  title: { default: "KingsView Solutions", template: "%s · KingsView Solutions" },
  description: "Websites and software, branding, design and printing, CCTV, office supplies, photography, training, branded items and IT supplies in Ghana.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-GH">
      <body className="min-h-screen font-sans antialiased">
        <a href="#main" className="skip-link">
          Skip to content
        </a>
        {children}
      </body>
    </html>
  );
}
