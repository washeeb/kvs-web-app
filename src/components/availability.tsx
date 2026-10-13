import type { Availability } from "@/server/modules/inventory";
import { Badge } from "./ui";

const LABEL: Record<Availability["status"], string> = {
  in_stock: "In stock",
  low_stock: "Low stock",
  out_of_stock: "Out of stock",
  not_tracked: "Available to order",
};

export function AvailabilityBadge({ a, showCount }: { a: Availability; showCount?: boolean }) {
  const tone = a.status === "in_stock" || a.status === "not_tracked" ? "green" : a.status === "low_stock" ? "amber" : "red";
  return (
    <Badge tone={tone}>
      {LABEL[a.status]}
      {showCount && (a.status === "in_stock" || a.status === "low_stock") ? ` · ${a.available}` : ""}
    </Badge>
  );
}
