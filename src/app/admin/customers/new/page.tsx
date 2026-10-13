import Link from "next/link";
import type { Metadata } from "next";
import { requireActor } from "@/server/web/session";
import { can } from "@/server/authz/policy";
import { ActionForm } from "@/components/action-form";
import { CustomerFields } from "@/components/customer-fields";
import { Card, EmptyState, PageHeader } from "@/components/ui";
import { saveCustomerAction } from "../../actions";

export const metadata: Metadata = { title: "New customer" };

export default async function NewCustomerPage() {
  const actor = await requireActor("operator");
  if (!can(actor, "customers.write")) return <EmptyState title="You can't open this page" />;
  return (
    <>
      <Link href="/admin/customers" className="text-sm text-teal-700 hover:underline">← Customers</Link>
      <div className="mt-4"><PageHeader title="New customer" description="Enter a phone number or an e-mail address (or both)." /></div>
      <Card>
        <ActionForm action={saveCustomerAction} submitLabel="Create customer">
          <input type="hidden" name="id" value="" />
          <CustomerFields c={null} />
        </ActionForm>
      </Card>
    </>
  );
}
