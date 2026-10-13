import type { MetadataRoute } from "next";

// Read APP_URL when served, not when built.
export const dynamic = "force-dynamic";

export default function robots(): MetadataRoute.Robots {
  const base = process.env.APP_URL ?? "http://localhost:3000";
  return {
    rules: [{ userAgent: "*", allow: "/", disallow: ["/admin", "/account", "/api/", "/login", "/reset-password", "/shop/cart", "/order/", "/dev"] }],
    sitemap: `${base}/sitemap.xml`,
  };
}
