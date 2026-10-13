import { Field } from "./ui";

type P = { name?: string; summary?: string | null; description?: string | null; categoryId?: string | null; status?: string; sesSync?: boolean } | null;

export function ProductFields({ p, categories }: { p: P; categories: { id: string; name: string }[] }) {
  return (
    <>
      <Field label="Product name" htmlFor="name"><input id="name" name="name" className="field" required minLength={3} maxLength={160} defaultValue={p?.name} /></Field>
      <Field label="Short summary" htmlFor="summary"><input id="summary" name="summary" className="field" maxLength={300} defaultValue={p?.summary ?? ""} /></Field>
      <Field label="Description" htmlFor="description"><textarea id="description" name="description" rows={4} className="field" maxLength={5000} defaultValue={p?.description ?? ""} /></Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Category" htmlFor="categoryId">
          <select id="categoryId" name="categoryId" className="field" defaultValue={p?.categoryId ?? ""}>
            <option value="">None</option>
            {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </Field>
        <Field label="Status" htmlFor="status">
          <select id="status" name="status" className="field" defaultValue={p?.status ?? "draft"}>
            <option value="draft">Draft (hidden)</option>
            <option value="active">Active (in the shop)</option>
            <option value="retired">Retired</option>
          </select>
        </Field>
      </div>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="sesSync" defaultChecked={p?.sesSync} /> Offer to Synclytics (sends name, cost and stock to SES)</label>
    </>
  );
}
