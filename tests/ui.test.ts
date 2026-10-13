import { describe, expect, it } from "vitest";
import { activeHref } from "@/components/side-nav";

describe("menu highlighting", () => {
  const items = [
    { href: "/admin", label: "Dashboard", exact: true },
    { href: "/admin/products", label: "Products" },
    { href: "/admin/products/locations", label: "Locations" },
    { href: "/admin/orders", label: "Orders" },
  ];
  it("picks the most specific menu entry for the page", () => {
    expect(activeHref("/admin", items)).toBe("/admin");
    expect(activeHref("/admin/products", items)).toBe("/admin/products");
    expect(activeHref("/admin/products/0b6c", items)).toBe("/admin/products");
    expect(activeHref("/admin/products/locations/x", items)).toBe("/admin/products/locations");
  });
  it("never highlights the dashboard for other pages, nor partial word matches", () => {
    expect(activeHref("/admin/notifications", items)).toBeNull();
    expect(activeHref("/admin/ordersx", items)).toBeNull();
  });
});

describe("barcode labels", () => {
  it("encode Code 128 with the right checksum and module count", async () => {
    const { code128B, code128Svg } = await import("@/server/lib/code128");
    const w = code128B("ABC");
    // start + 3 characters + checksum = 5 symbols of 11 modules, plus a 13-module stop.
    expect(w.reduce((a, b) => a + b, 0)).toBe(5 * 11 + 13);
    // Checksum for "ABC" in subset B: (104 + 33·1 + 34·2 + 35·3) mod 103 = 1 → pattern 222122.
    expect(w.slice(4 * 6, 5 * 6).join("")).toBe("222122");
    expect(code128Svg("KV-NET-00001").svg).toMatch(/^<svg [^>]*viewBox/);
    expect(() => code128B("é")).toThrow(/not allowed/);
  });
});
