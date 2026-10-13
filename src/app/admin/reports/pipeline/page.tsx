import type { Metadata } from "next";
import { getDb } from "@/server/db/client";
import { requireActor } from "@/server/web/session";
import { parseRange, pipelineReport } from "@/server/modules/analytics";
import { Kpi, RangePicker } from "@/components/charts";
import { Card, EmptyState, Money, PageHeader, TableWrap } from "@/components/ui";

export const metadata: Metadata = { title: "Enquiries & jobs" };

export default async function PipelinePage({ searchParams }: { searchParams: Promise<{ range?: string; from?: string; to?: string }> }) {
  const actor = await requireActor("operator");
  const sp = await searchParams;
  const r = parseRange(sp);
  const p = await pipelineReport(getDb(), actor, r);
  const qs = new URLSearchParams(Object.entries(sp).filter(([, v]) => v) as [string, string][]).toString();
  return (
    <>
      <PageHeader title="Enquiries, quotations & jobs" description={`${r.label}, by service line. Win rate = accepted ÷ quotations sent. Job time = days from booking to completion.`} />
      <RangePicker sp={sp} csvHref={`/api/reports/pipeline?${qs}`} />
      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <Kpi label="Enquiries" value={p.totals.enquiries} />
        <Kpi label="Quotations" value={p.totals.quotes} />
        <Kpi label="Quotations won" value={p.totals.won} />
      </div>
      <Card>
        {p.byLine.length === 0 ? <EmptyState title="No activity in this period" /> : (
          <TableWrap>
            <table className="table">
              <thead><tr><th>Service</th><th className="text-right">Enquiries</th><th className="text-right">Quotations</th><th className="text-right">Won</th><th className="text-right">Win rate</th><th className="text-right">Won value</th><th className="text-right">Jobs done</th><th className="text-right">Avg job days</th></tr></thead>
              <tbody>
                {p.byLine.map((x) => (
                  <tr key={x.line}>
                    <td>{x.label}</td>
                    <td className="text-right tabular-nums">{x.enquiries}</td>
                    <td className="text-right tabular-nums">{x.quotes}</td>
                    <td className="text-right tabular-nums">{x.won}</td>
                    <td className="text-right tabular-nums">{x.winRate === null ? "—" : `${x.winRate}%`}</td>
                    <td className="text-right tabular-nums"><Money minor={x.wonValue} /></td>
                    <td className="text-right tabular-nums">{x.jobsDone} / {x.jobsTotal}</td>
                    <td className="text-right tabular-nums">{x.avgJobDays ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        )}
      </Card>
    </>
  );
}
