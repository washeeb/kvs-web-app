import Image from "next/image";
import Link from "next/link";
import landscape from "@/assets/brand/kvs-landscape.png";
import landscapeDark from "@/assets/brand/kvs-landscape-dark.png";
import stacked from "@/assets/brand/kvs-stacked.png";
import stackedDark from "@/assets/brand/kvs-stacked-dark.png";
import crest from "@/assets/brand/kvs-crest.png";
import crestDark from "@/assets/brand/kvs-crest-dark.png";

const VARIANTS = {
  /** Default: landscape lockup. */
  landscape: { src: landscape, dark: landscapeDark, height: 44 },
  stacked: { src: stacked, dark: stackedDark, height: 140 },
  /** Crowned-lion crest alone. */
  crest: { src: crest, dark: crestDark, height: 56 },
} as const;

/**
 * The KingsView logo. Its black parts are transparent black, so a white-on-dark version (from `npm run brand:build`)
 * takes over in the dark theme and inside `.on-dark` areas (footer, slider). CSS picks one, so nothing flashes.
 */
export function Logo({ href = "/", variant = "landscape", height }: { href?: string | null; variant?: keyof typeof VARIANTS; height?: number }) {
  const v = VARIANTS[variant];
  const h = height ?? v.height;
  const priority = variant === "landscape";
  const img = (
    <>
      <Image src={v.src} alt="KingsView Solutions" height={h} style={{ height: h, width: "auto" }} priority={priority} className="logo-for-light" />
      <Image src={v.dark} alt="KingsView Solutions" height={h} style={{ height: h, width: "auto" }} priority={priority} className="logo-for-dark" />
    </>
  );
  if (href === null) return <span className="inline-flex shrink-0 items-center">{img}</span>;
  return (
    <Link href={href} aria-label="KingsView Solutions — home" className="inline-flex shrink-0 items-center">
      {img}
    </Link>
  );
}
