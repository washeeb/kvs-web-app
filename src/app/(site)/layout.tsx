import Link from "next/link";
import { Logo } from "@/components/logo";
import { ThemeSwitch } from "@/components/theme-switch";
import { getSessionState } from "@/server/web/session";
import { getDb } from "@/server/db/client";
import { getSettings, phoneNumbers } from "@/server/modules/settings";
import { cartCount } from "@/server/modules/shop";
import { readCart } from "@/server/web/cart";
import { SERVICE_LINES } from "@/content/services";

const NAV = [
  { href: "/services", label: "Services" },
  { href: "/shop", label: "Shop" },
  { href: "/contact", label: "Contact" },
];

export default async function SiteLayout({ children }: { children: React.ReactNode }) {
  const [session, s, cart] = await Promise.all([getSessionState(), getSettings(getDb()), readCart()]);
  const items = cartCount(cart);
  const cartLink = { href: "/shop/cart", label: items ? `Cart (${items})` : "Cart" };
  const staff = session && !session.pending ? { href: "/admin", label: "Staff area" } : null;
  return (
    <>
      <header className="sticky top-0 z-40 border-b border-slate-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-2">
          <Logo />
          <nav aria-label="Main" className="hidden items-center gap-6 md:flex">
            {NAV.map((n) => (
              <Link key={n.href} href={n.href} className="text-sm font-medium text-slate-800 hover:text-teal-700">{n.label}</Link>
            ))}
            <Link href={cartLink.href} className="text-sm font-medium text-slate-800 hover:text-teal-700">{cartLink.label}</Link>
            <ThemeSwitch />
            {staff ? <Link href={staff.href} className="btn btn-ghost">{staff.label}</Link> : <Link href="/contact" className="btn btn-accent">Get a quote</Link>}
          </nav>
          <details className="relative md:hidden">
            <summary className="btn btn-ghost list-none" aria-label="Open menu">Menu</summary>
            <nav aria-label="Mobile" className="absolute right-0 mt-2 w-56 rounded-xl border border-slate-200 bg-white p-2 shadow-lg">
              {[...NAV, cartLink, ...(staff ? [staff] : [])].map((n) => (
                <Link key={n.href} href={n.href} className="block rounded-md px-3 py-2 text-sm hover:bg-slate-50">{n.label}</Link>
              ))}
              <div className="mt-2 flex items-center justify-between border-t border-slate-200 px-3 pt-2 text-sm text-slate-600">Theme <ThemeSwitch /></div>
            </nav>
          </details>
        </div>
      </header>
      <main id="main">{children}</main>
      <footer className="on-dark mt-16 border-t border-[#fff]/10 bg-brand-900 text-[#cbd5e1]">
        <div className="mx-auto grid max-w-6xl gap-8 px-4 py-10 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <div className="flex items-center gap-3">
              <Logo variant="crest" href={null} height={48} />
              <p className="text-lg font-bold text-[#fff]">KingsView Solutions</p>
            </div>
            <p className="mt-3 text-sm">Technology, design and supplies for businesses, schools, churches and homes in Ghana.</p>
          </div>
          <div>
            <h2 className="text-sm font-semibold text-[#fff]">Services</h2>
            <ul className="mt-2 space-y-1 text-sm">
              {SERVICE_LINES.slice(0, 9).map((l) => (
                <li key={l.slug}><Link href={`/services/${l.slug}`} className="hover:text-[#fff]">{l.title}</Link></li>
              ))}
            </ul>
          </div>
          <div>
            <h2 className="text-sm font-semibold text-[#fff]">Contact</h2>
            <ul className="mt-2 space-y-1 text-sm">
              {s.contactPhone && <li>Phone: {phoneNumbers(s).map((p, i) => <span key={p}>{i > 0 && ", "}<a href={`tel:${p.replace(/\s+/g, "")}`} className="hover:text-[#fff]">{p}</a></span>)}</li>}
              {s.whatsappNumber && <li>WhatsApp: {s.whatsappNumber}</li>}
              <li>E-mail: <a href={`mailto:${s.contactEmail}`} className="hover:text-[#fff]">{s.contactEmail}</a></li>
              {s.companyAddress && <li>{s.companyAddress}</li>}
              {s.openingHours && <li>{s.openingHours}</li>}
            </ul>
          </div>
          <div>
            <h2 className="text-sm font-semibold text-[#fff]">Follow us</h2>
            <ul className="mt-2 space-y-1 text-sm">
              {s.instagramUrl && <li><a href={s.instagramUrl} rel="noopener noreferrer" className="hover:text-[#fff]">Instagram</a></li>}
              {s.facebookUrl && <li><a href={s.facebookUrl} rel="noopener noreferrer" className="hover:text-[#fff]">Facebook</a></li>}
              <li><Link href="/privacy" className="hover:text-[#fff]">Privacy notice</Link></li>
              <li><Link href="/login" className="hover:text-[#fff]">Staff sign-in</Link></li>
            </ul>
          </div>
        </div>
        <p className="border-t border-[#fff]/10 py-4 text-center text-xs text-[#94a3b8]">
          © {new Date().getFullYear()} KingsView Solutions{s.dpcRegistrationNumber ? ` · Data Protection Commission reg. ${s.dpcRegistrationNumber}` : ""}
        </p>
      </footer>
    </>
  );
}
