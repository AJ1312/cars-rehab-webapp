import { requireStaff } from '@/lib/server/auth';
import { getStore } from '@/lib/server/store';
import { Pager } from '@/components/admin/Bits';
import { fmtDateTime, q1 } from '@/lib/format';

export const metadata = { title: 'Audit log' };
const PAGE = 60;

export default async function Audit({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireStaff('admin');
  const page = Math.max(1, Number(q1((await searchParams).page)) || 1);
  const rows = await getStore().listAudit(PAGE + 1, (page - 1) * PAGE);
  const more = rows.length > PAGE;
  return (
    <>
      <div><h1>Audit log</h1><p className="sub">Sign-ins, uploads, exports, phone and account changes. Newest first.</p></div>
      <div className="table-wrap"><table><thead><tr><th>When</th><th>Who</th><th>What</th><th>Target</th><th>Details</th></tr></thead><tbody>
        {rows.slice(0, PAGE).map((a) => <tr key={a.id}><td>{fmtDateTime(a.at)}</td><td>{a.actor}</td><td>{a.action}</td><td style={{ fontSize: 13 }}>{a.target ?? ''}</td><td style={{ fontSize: 13, whiteSpace: 'normal', minWidth: 160 }}>{a.detail ? JSON.stringify(a.detail).slice(0, 160) : ''}</td></tr>)}
      </tbody></table></div>
      <Pager base="/admin/audit" page={page} pages={more ? page + 1 : page} params={{}} />
    </>
  );
}
