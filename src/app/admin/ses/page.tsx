import type { Metadata } from "next";
import { getDb } from "@/server/db/client";
import { requireActor } from "@/server/web/session";
import { can } from "@/server/authz/policy";
import { sesStatus } from "@/server/modules/ses-link";
import { appUrl } from "@/server/web/session";
import { ActionForm } from "@/components/action-form";
import { Badge, Card, DateTime, EmptyState, PageHeader, Stat, StatusBadge, TableWrap } from "@/components/ui";
import { LiveRefresh } from "@/components/live-refresh";
import { sesAction } from "../actions";

export const metadata: Metadata = { title: "Synclytics link" };

export default async function SesPage() {
  const actor = await requireActor("operator");
  if (!can(actor, "integrations.read")) return <EmptyState title="You can't open this page" />;
  const s = await sesStatus(getDb(), actor);
  const manage = can(actor, "integrations.manage");
  return (
    <>
      <PageHeader
        title="Synclytics link"
        description="KingsView is a supply partner of Synclytics Enterprise Systems (SES). Products marked “Offer to Synclytics” send their name, cost and available stock to SES; SES sends orders here for us to fulfil."
        actions={<><LiveRefresh topics={["integrations", "orders"]} />{s.configured ? <Badge tone={s.mode === "production" ? "green" : "purple"}>{s.mode === "production" ? "Connected (live)" : "Connected (test)"}</Badge> : <Badge tone="amber">Not configured</Badge>}</>}
      />
      {!s.configured ? (
        <Card>
          <p className="text-sm text-slate-700">The link is off. When Synclytics creates the KingsView connection it will give you a connection ID and two signing secrets. Put them in the server settings (<code>SES_BASE_URL</code>, <code>SES_CONNECTION_ID</code>, <code>SES_SIGNING_SECRET</code>, <code>SES_VERIFY_SECRET</code>) and ask SES to send orders to:</p>
          <p className="mt-2 font-mono text-sm">{appUrl()}/api/ses/events</p>
        </Card>
      ) : (
        <div className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-4">
            <Stat label="Products offered" value={s.syncedProducts} />
            <Stat label="Updates waiting" value={s.counts.queued ?? 0} />
            <Stat label="Updates delivered" value={s.counts.sent ?? 0} />
            <Stat label="Updates failed" value={s.counts.dead ?? 0} tone={s.counts.dead ? "red" : undefined} />
          </div>
          {manage && (
            <Card title="Resend everything">
              <ActionForm action={sesAction} submitLabel="Send all offered products, costs and stock again" submitClassName="btn btn-ghost">
                <input type="hidden" name="op" value="resync" />
                <p className="text-sm text-slate-600">Use after first connecting, or if SES reports missing items. Safe to repeat.</p>
              </ActionForm>
            </Card>
          )}
          <Card title="Recent updates to SES">
            {s.recentOut.length === 0 ? <EmptyState title="Nothing sent yet" /> : (
              <TableWrap>
                <table className="table">
                  <thead><tr><th>When</th><th>Event</th><th>Item</th><th>Status</th><th>Attempts</th></tr></thead>
                  <tbody>
                    {s.recentOut.map((e) => (
                      <tr key={e.id}>
                        <td className="text-xs"><DateTime value={e.createdAt} /></td>
                        <td className="text-xs">{e.type}</td>
                        <td className="font-mono text-xs">{e.entityKey}</td>
                        <td><StatusBadge status={e.status === "sent" ? "done" : e.status} />{e.lastError && <span className="block max-w-xs truncate text-xs text-slate-600" title={e.lastError}>{e.lastStatus ? `HTTP ${e.lastStatus}: ` : ""}{e.lastError}</span>}</td>
                        <td className="text-xs">
                          {e.attempts}
                          {manage && e.status === "dead" && (
                            <ActionForm action={sesAction} inline submitLabel="Retry" submitClassName="ml-2 text-xs text-teal-700 underline">
                              <input type="hidden" name="op" value="retry" /><input type="hidden" name="id" value={e.id} />
                            </ActionForm>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableWrap>
            )}
          </Card>
          <Card title="Recent messages from SES">
            {s.recentIn.length === 0 ? <EmptyState title="Nothing received yet" /> : (
              <ul className="space-y-1 text-sm">
                {s.recentIn.map((e) => <li key={e.id}><DateTime value={e.receivedAt} /> · {e.type} · <StatusBadge status={e.status === "processed" ? "done" : e.status} /></li>)}
              </ul>
            )}
          </Card>
        </div>
      )}
    </>
  );
}
