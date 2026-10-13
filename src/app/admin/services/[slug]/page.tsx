import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { getDb } from "@/server/db/client";
import { requireActor } from "@/server/web/session";
import { can } from "@/server/authz/policy";
import { serviceBySlug } from "@/content/services";
import { listMedia } from "@/server/modules/media";
import { ImageManager } from "@/components/image-manager";
import { Card, EmptyState, PageHeader } from "@/components/ui";
import { imageAction, uploadImageAction } from "../../actions";

export const metadata: Metadata = { title: "Service pictures" };

export default async function ServiceImagesPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const actor = await requireActor("operator");
  if (!can(actor, "catalogue.read")) return <EmptyState title="You can't open this page" />;
  const s = serviceBySlug(slug);
  if (!s) notFound();
  const images = await listMedia(getDb(), "service", [s.slug]);
  return (
    <>
      <Link href="/admin/services" className="text-sm text-teal-700 hover:underline">← Service pages</Link>
      <div className="mt-4">
        <PageHeader title={s.title} description={<>The first picture is the page banner (wide pictures work best); the others show as a gallery. <Link href={`/services/${s.slug}`} className="text-teal-700 underline">View the page</Link></>} />
      </div>
      <Card title="Pictures">
        <ImageManager images={images} ownerType="service" ownerId={s.slug} defaultAlt={s.title} canWrite={can(actor, "catalogue.write")} uploadAction={uploadImageAction} imageAction={imageAction} />
      </Card>
    </>
  );
}
