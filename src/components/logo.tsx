import Image from "next/image";
import Link from "next/link";
import landscape from "@/assets/brand/kvs-landscape.png";
import stacked from "@/assets/brand/kvs-stacked.png";
import crest from "@/assets/brand/kvs-crest.png";

const VARIANTS = {
  /** Default: transparent landscape lockup for light backgrounds. */
  landscape: { src: landscape, height: 44 },
  stacked: { src: stacked, height: 140 },
  /** Crowned-lion crest alone (works on light and dark backgrounds). */
  crest: { src: crest, height: 56 },
} as const;

export function Logo({ href = "/", variant = "landscape", height }: { href?: string | null; variant?: keyof typeof VARIANTS; height?: number }) {
  const v = VARIANTS[variant];
  const h = height ?? v.height;
  const img = <Image src={v.src} alt="KingsView Solutions" height={h} style={{ height: h, width: "auto" }} priority={variant === "landscape"} />;
  if (href === null) return img;
  return (
    <Link href={href} aria-label="KingsView Solutions — home" className="inline-flex shrink-0 items-center">
      {img}
    </Link>
  );
}
