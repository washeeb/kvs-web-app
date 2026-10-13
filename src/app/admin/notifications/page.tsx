import type { Metadata } from "next";
import { requireActor } from "@/server/web/session";
import { NotificationList } from "@/components/notifications";

export const metadata: Metadata = { title: "Notifications" };

export default async function Page() {
  const actor = await requireActor("operator");
  return <NotificationList actor={actor} path="/admin/notifications" />;
}
