import { Field } from "./ui";

type S = { id: string; name: string; contactName: string | null; email: string | null; phone: string | null; address: string | null; taxId: string | null; paymentTermsDays: number; leadTimeDays: number | null; active: boolean; notes: string | null };

export function SupplierFields({ s }: { s: S | null }) {
  return (
    <>
      {s && <input type="hidden" name="id" value={s.id} />}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Name" htmlFor="name"><input id="name" name="name" className="field" required minLength={2} maxLength={120} defaultValue={s?.name} /></Field>
        <Field label="Contact person" htmlFor="contactName"><input id="contactName" name="contactName" className="field" maxLength={120} defaultValue={s?.contactName ?? ""} /></Field>
        <Field label="E-mail" htmlFor="email" hint="Purchase orders can be e-mailed here."><input id="email" name="email" type="email" className="field" maxLength={200} defaultValue={s?.email ?? ""} /></Field>
        <Field label="Phone" htmlFor="phone"><input id="phone" name="phone" type="tel" className="field" maxLength={40} defaultValue={s?.phone ?? ""} /></Field>
      </div>
      <Field label="Address" htmlFor="address"><input id="address" name="address" className="field" maxLength={300} defaultValue={s?.address ?? ""} /></Field>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="TIN" htmlFor="taxId"><input id="taxId" name="taxId" className="field" maxLength={40} defaultValue={s?.taxId ?? ""} /></Field>
        <Field label="Payment terms (days)" htmlFor="paymentTermsDays"><input id="paymentTermsDays" name="paymentTermsDays" type="number" min={0} max={365} className="field" defaultValue={s?.paymentTermsDays ?? 30} /></Field>
        <Field label="Lead time (days)" htmlFor="leadTimeDays" hint="Order to delivery."><input id="leadTimeDays" name="leadTimeDays" type="number" min={0} max={365} className="field" defaultValue={s?.leadTimeDays ?? ""} /></Field>
      </div>
      <Field label="Notes" htmlFor="notes"><textarea id="notes" name="notes" rows={2} className="field" maxLength={2000} defaultValue={s?.notes ?? ""} /></Field>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="active" defaultChecked={s?.active ?? true} /> Active</label>
    </>
  );
}
