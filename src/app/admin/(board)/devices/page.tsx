import { requireStaff } from '@/lib/server/auth';
import { getStore } from '@/lib/server/store';
import { revokeDeviceAction } from '../actions';
import { ago } from '@/lib/format';

export const metadata = { title: 'Phones' };

export default async function Devices() {
  await requireStaff('admin');
  const store = getStore();
  const [devices, rows] = await Promise.all([store.listDevices(), store.listSessions({ limit: 5000 })]);
  const counts = new Map<string, number>(); rows.forEach((r) => r.deviceId && counts.set(r.deviceId, (counts.get(r.deviceId) || 0) + 1));
  return (
    <>
      <div><h1>Phones</h1><p className="sub">A phone appears here by itself the first time it uploads a session. Nothing to set up on the phone. If one is lost, or a name looks wrong, remove it: it stops uploading at once and its earlier sessions stay in the data.</p></div>
      <section className="panel"><h2>Phones that have uploaded</h2>
        {devices.length === 0 ? <div className="empty">No phones yet. Run a session on a phone with internet and it shows up here.</div> : (
          <div className="table-wrap"><table><thead><tr><th>Name</th><th>Status</th><th className="r">Sessions</th><th>Last seen</th><th /></tr></thead><tbody>
            {devices.map((d) => (
              <tr key={d.id}><td>{d.label}</td>
                <td>{d.revokedAt ? <span className="flag bad">Removed</span> : <span className="flag info">Active</span>}</td>
                <td className="r">{counts.get(d.id) ?? 0}</td><td>{ago(d.lastSeenAt)}</td>
                <td>{!d.revokedAt && <form action={revokeDeviceAction}><input type="hidden" name="id" value={d.id} /><button className="btn sm danger">Remove</button></form>}</td></tr>
            ))}</tbody></table></div>
        )}
      </section>
    </>
  );
}
