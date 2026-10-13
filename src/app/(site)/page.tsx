import Link from "next/link";
import { getDb } from "@/server/db/client";
import { listCategoriesTree } from "@/server/modules/taxonomy";
import { mainImages } from "@/server/modules/media";
import { Picture } from "@/components/picture";
import { SERVICE_LINES } from "@/content/services";
import { Logo } from "@/components/logo";
import { HeroSlider } from "@/components/hero-slider";
import { liveSlides } from "@/server/modules/slides";

export default async function Home() {
  const db = getDb();
  const cats = (await listCategoriesTree(db)).filter(
    (c) => c.active && c.depth === 0,
  );
  const [serviceImages, catImages, slides] = await Promise.all([
    mainImages(
      db,
      "service",
      SERVICE_LINES.map((s) => s.slug),
    ),
    mainImages(
      db,
      "category",
      cats.map((c) => c.id),
    ),
    liveSlides(db),
  ]);
  return (
    <>
      {slides.length > 0 ? (
        <HeroSlider slides={slides} />
      ) : (
        <section className="border-b border-slate-200 bg-white">
          <div className="mx-auto grid max-w-6xl items-center gap-10 px-4 py-14 md:grid-cols-[1.3fr_1fr]">
            <div>
              <p className="text-sm font-semibold uppercase tracking-wide text-teal-700">
                KingsView Solutions
              </p>
              <h1 className="mt-2 text-4xl font-bold leading-tight text-slate-900 md:text-5xl">
                Technology, design and supplies — handled in one place.
              </h1>
              <p className="mt-4 max-w-xl text-lg text-slate-700">
                Websites and software, branding and printing, CCTV installation,
                photography, training, branded items, office supplies and IT
                equipment for businesses, schools, churches and homes.
              </p>
              <div className="mt-6 flex flex-wrap gap-3">
                <Link href="/contact" className="btn btn-accent">
                  Request a quotation
                </Link>
                <Link href="/shop" className="btn btn-primary">
                  Visit the shop
                </Link>
              </div>
            </div>
            <div className="flex justify-center">
              <Logo variant="stacked" href={null} height={240} />
            </div>
          </div>
        </section>
      )}

      <section
        className="mx-auto max-w-6xl px-4 py-14"
        aria-labelledby="services-heading"
      >
        <h2 id="services-heading" className="text-2xl font-bold text-slate-900">
          What we do
        </h2>
        <ul className="mt-6 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {SERVICE_LINES.map((s) => (
            <li
              key={s.slug}
              className="flex flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm"
            >
              {serviceImages.get(s.slug) && (
                <Picture
                  m={serviceImages.get(s.slug)!}
                  sizes="(min-width: 1024px) 360px, (min-width: 640px) 50vw, 100vw"
                  fallbackWidth={800}
                  className="aspect-[3/2] w-full object-cover"
                  alt=""
                />
              )}
              <div className="flex flex-1 flex-col p-5">
                <h3 className="text-lg font-semibold">
                  <Link
                    href={`/services/${s.slug}`}
                    className="hover:text-teal-700"
                  >
                    {s.title}
                  </Link>
                </h3>
                <p className="mt-1 flex-1 text-sm text-slate-600">{s.short}</p>
                <p className="mt-3 text-sm font-medium">
                  <Link
                    href={`/services/${s.slug}`}
                    className="text-teal-700 underline"
                  >
                    Find out more
                    <span className="sr-only"> about {s.title}</span>
                  </Link>
                </p>
              </div>
            </li>
          ))}
        </ul>
      </section>

      {cats.length > 0 && (
        <section className="bg-white py-14" aria-labelledby="shop-heading">
          <div className="mx-auto max-w-6xl px-4">
            <h2 id="shop-heading" className="text-2xl font-bold text-slate-900">
              Shop online
            </h2>
            <p className="mt-1 text-slate-600">
              Order for pickup or delivery and pay by mobile money, card or
              transfer.
            </p>
            <ul className="mt-6 grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-5">
              {cats.map((c) => {
                const img = catImages.get(c.id);
                return (
                  <li key={c.id}>
                    <Link
                      href={`/shop?category=${c.slug}`}
                      className="group block overflow-hidden rounded-xl border border-slate-200 bg-white hover:border-teal-700"
                    >
                      {img ? (
                        <Picture
                          m={img}
                          sizes="(min-width: 1024px) 220px, 45vw"
                          fallbackWidth={320}
                          className="aspect-[3/2] w-full object-cover"
                          alt=""
                        />
                      ) : (
                        <span
                          className="block aspect-[3/2] w-full bg-slate-100"
                          aria-hidden="true"
                        />
                      )}
                      <span className="block px-3 py-2 text-sm font-semibold text-slate-900 group-hover:text-teal-700">
                        {c.name}
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        </section>
      )}
    </>
  );
}
