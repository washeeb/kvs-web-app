import type { MetadataRoute } from "next";

/** Lets phones add the site to the home screen with the KingsView crest (icons from `npm run brand:build`). */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "KingsView Solutions",
    short_name: "KingsView",
    description: "Technology, design and supplies for businesses, schools, churches and homes in Ghana.",
    start_url: "/",
    display: "minimal-ui",
    background_color: "#ffffff",
    theme_color: "#111111",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
