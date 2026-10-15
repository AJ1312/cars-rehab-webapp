import { requireStaff } from '@/lib/server/auth';
import { getStore } from '@/lib/server/store';
import { EnrolDeviceForm } from '@/components/admin/Forms';
import { revokeDeviceAction } from '../actions';
import { ago, fmtDateTime } from '@/lib/format';

export const metadata = { title: 'Phones' };

export default async function Devices() {
  await requireStaff('admin');
  const store = getStore();
  const [devices, rows] = await Promise.all([store.listDevices(), store.listSessions({ limit: 5000 })]);
  const counts = new Map<string, number>(); rows.forEach((r) => r.deviceId && counts.set(r.deviceId, (counts.get(r.deviceId) || 0) + 1));
  return (
    <>
      <div><h1>Phones</h1><p className="sub">Only enrolled phones can upload data. Remove a phone here and it stops working immediately, even if it is lost.</p></div>
      <div className="cols">
        <EnrolDeviceForm />
        <section className="panel"><h2>Enrolled phones</h2>
          {devices.length === 0 ? <div className="empty">No phones yet.</div> : (
            <div className="table-wrap"><table><thead><tr><th>Name</th><th>Status</th><th className="r">Sessions</th><th>Last seen</th><th /></tr></thead><tbody>
              {devices.map((d) => (
                <tr key={d.id}><td>{d.label}</td>
                  <td>{d.revokedAt ? <span className="flag bad">Removed</span> : d.pending ? <span className="flag warn" title={`Expires ${fmtDateTime(d.enrolExpiresAt)}`}>Waiting for scan</span> : <span className="flag info">Active</span>}</td>
                  <td className="r">{counts.get(d.id) ?? 0}</td><td>{ago(d.lastSeenAt)}</td>
                  <td>{!d.revokedAt && <form action={revokeDeviceAction}><input type="hidden" name="id" value={d.id} /><button className="btn sm danger">Remove</button></form>}</td></tr>
              ))}</tbody></table></div>
          )}
        </section>
      </div>
    </>
  );
}
