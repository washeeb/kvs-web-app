import { SERVICE_LINES } from "@/content/services";
import { enquiryAction } from "@/app/(site)/actions";
import { ActionForm } from "./action-form";
import { Field } from "./ui";

/** Enquiry / quotation request. Works without JavaScript; spam is filtered by a hidden field and rate limits. */
export function EnquiryForm({ serviceLine = "", submitLabel = "Send request", placeholder }: { serviceLine?: string; submitLabel?: string; placeholder?: string }) {
  return (
    <ActionForm action={enquiryAction} submitLabel={submitLabel} submitClassName="btn btn-accent" resetOnSuccess>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Your name" htmlFor="name"><input id="name" name="name" className="field" required autoComplete="name" maxLength={120} /></Field>
        <Field label="Business or organisation (optional)" htmlFor="company"><input id="company" name="company" className="field" autoComplete="organization" maxLength={160} /></Field>
        <Field label="Phone or WhatsApp" htmlFor="phone"><input id="phone" name="phone" type="tel" className="field" autoComplete="tel" maxLength={40} /></Field>
        <Field label="E-mail (optional if you give a phone)" htmlFor="email"><input id="email" name="email" type="email" className="field" autoComplete="email" maxLength={200} /></Field>
      </div>
      <Field label="Service" htmlFor="serviceLine">
        <select id="serviceLine" name="serviceLine" className="field" defaultValue={serviceLine}>
          <option value="">Not sure / several</option>
          {SERVICE_LINES.map((s) => <option key={s.slug} value={s.slug}>{s.title}</option>)}
        </select>
      </Field>
      <Field label="What do you need?" htmlFor="message">
        <textarea id="message" name="message" rows={5} className="field" required minLength={10} maxLength={4000} placeholder={placeholder} />
      </Field>
      {/* Honeypot for bots: hidden from people and assistive technology. */}
      <div aria-hidden className="absolute -left-[10000px]">
        <label htmlFor="website">Website</label>
        <input id="website" name="website" tabIndex={-1} autoComplete="off" />
      </div>
    </ActionForm>
  );
}
