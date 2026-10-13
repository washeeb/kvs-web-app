import { Field } from "./ui";

type C = { name?: string; company?: string | null; phone?: string | null; email?: string | null; address?: string | null; notes?: string | null } | null;

export function CustomerFields({ c }: { c: C }) {
  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Name" htmlFor="name"><input id="name" name="name" className="field" required maxLength={120} defaultValue={c?.name} /></Field>
        <Field label="Business (optional)" htmlFor="company"><input id="company" name="company" className="field" maxLength={160} defaultValue={c?.company ?? ""} /></Field>
        <Field label="Phone" htmlFor="phone"><input id="phone" name="phone" type="tel" className="field" maxLength={40} defaultValue={c?.phone ?? ""} /></Field>
        <Field label="E-mail" htmlFor="email"><input id="email" name="email" type="email" className="field" maxLength={200} defaultValue={c?.email ?? ""} /></Field>
      </div>
      <Field label="Address" htmlFor="address"><input id="address" name="address" className="field" maxLength={400} defaultValue={c?.address ?? ""} /></Field>
      <Field label="Notes" htmlFor="notes"><textarea id="notes" name="notes" rows={2} className="field" maxLength={2000} defaultValue={c?.notes ?? ""} /></Field>
    </>
  );
}
