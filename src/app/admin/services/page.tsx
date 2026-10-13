import Link from "next/link";
import type { Metadata } from "next";
import { getDb } from "@/server/db/client";
import { requireActor } from "@/server/web/session";
import { can } from "@/server/authz/policy";
import { SERVICE_LINES } from "@/content/services";
import { listMedia } from "@/server/modules/media";
import { NoPicture, Picture } from "@/components/picture";
import { Card, EmptyState, PageHeader } from "@/components/ui";

export const metadata: Metadata = { title: "Service pages" };

export default async function ServicesAdminPage() {
  const actor = await requireActor("operator");
  if (!can(actor, "catalogue.read")) return <EmptyState title="You can't open this page" />;
  const images = await listMedia(getDb(), "service", SERVICE_LINES.map((s) => s.slug));
  return (
    <>
      <PageHeader title="Service pages" description="Pictures for each service page on the website: the first is the banner, the rest form a gallery of past work." />
      <Card>
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {SERVICE_LINES.map((s) => {
            const mine = images.filter((m) => m.ownerId === s.slug);
            return (
              <li key={s.slug} className="rounded-lg border border-slate-200 p-3">
                {mine[0] ? <Picture m={mine[0]} sizes="(min-width: 1024px) 300px, 50vw" fallbackWidth={320} className="aspect-[3/2] w-full rounded object-cover" alt="" /> : <NoPicture label={s.title} className="aspect-[3/2] w-full rounded" />}
                <Link href={`/admin/services/${s.slug}`} className="mt-2 block font-medium text-teal-700 hover:underline">{s.title}</Link>
                <p className="text-xs text-slate-600">{mine.length} picture{mine.length === 1 ? "" : "s"}</p>
              </li>
            );
          })}
        </ul>
      </Card>
    </>
  );
}
