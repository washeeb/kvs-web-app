import { Field } from "./ui";

type P = {
  name?: string;
  summary?: string | null;
  description?: string | null;
  categoryId?: string | null;
  brandId?: string | null;
  specs?: { name: string; value: string }[];
  status?: string;
  sesSync?: boolean;
} | null;

export type CategoryOption = { id: string; name: string; depth: number; active: boolean };

export function ProductFields({
  p,
  categories,
  brands,
  tagNames,
  tags = [],
}: {
  p: P;
  categories: CategoryOption[];
  brands: { id: string; name: string; active: boolean }[];
  /** All existing tag names, offered as suggestions. */
  tagNames: string[];
  /** This product's tags. */
  tags?: string[];
}) {
  return (
    <>
      <Field label="Product name" htmlFor="name"><input id="name" name="name" className="field" required minLength={3} maxLength={160} defaultValue={p?.name} /></Field>
      <Field label="Short summary" htmlFor="summary"><input id="summary" name="summary" className="field" maxLength={300} defaultValue={p?.summary ?? ""} /></Field>
      <Field label="Description" htmlFor="description"><textarea id="description" name="description" rows={4} className="field" maxLength={5000} defaultValue={p?.description ?? ""} /></Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Category" htmlFor="categoryId">
          <select id="categoryId" name="categoryId" className="field" defaultValue={p?.categoryId ?? ""}>
            <option value="">None</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.depth ? "  — " : ""}
                {c.name}
                {c.active ? "" : " (hidden)"}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Brand" htmlFor="brandId">
          <select id="brandId" name="brandId" className="field" defaultValue={p?.brandId ?? ""}>
            <option value="">None</option>
            {brands.map((b) => <option key={b.id} value={b.id}>{b.name}{b.active ? "" : " (hidden)"}</option>)}
          </select>
        </Field>
      </div>
      <Field label="Tags" htmlFor="tagsText" hint="Separate with commas, e.g. wireless, back to school. New tags are created automatically.">
        <input id="tagsText" name="tagsText" className="field" maxLength={1000} defaultValue={tags.join(", ")} list="tag-suggestions" autoComplete="off" />
      </Field>
      <datalist id="tag-suggestions">{tagNames.map((t) => <option key={t} value={t} />)}</datalist>
      <Field label="Specifications" htmlFor="specsText" hint={'One per line, as "Name: value" — e.g. "Resolution: 4 MP". Shown as a table on the product page.'}>
        <textarea id="specsText" name="specsText" rows={4} className="field font-mono text-sm" maxLength={10000} defaultValue={(p?.specs ?? []).map((s) => `${s.name}: ${s.value}`).join("\n")} />
      </Field>
      <Field label="Status" htmlFor="status">
        <select id="status" name="status" className="field" defaultValue={p?.status ?? "draft"}>
          <option value="draft">Draft (hidden)</option>
          <option value="active">Active (in the shop)</option>
          <option value="retired">Retired</option>
        </select>
      </Field>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="sesSync" defaultChecked={p?.sesSync} /> Offer to Synclytics (sends name, cost and stock to SES)</label>
    </>
  );
}
