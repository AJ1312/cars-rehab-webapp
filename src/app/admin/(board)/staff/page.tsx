import { requireStaff } from '@/lib/server/auth';
import { getStore } from '@/lib/server/store';
import { ResetForm, StaffForm } from '@/components/admin/Forms';
import { setStaffActiveAction } from '../actions';
import { ago } from '@/lib/format';

export const metadata = { title: 'Staff' };

export default async function Staff() {
  const me = await requireStaff('admin');
  const list = await getStore().listStaff();
  return (
    <>
      <div><h1>Staff</h1><p className="sub">Who can sign in to this admin board.</p></div>
      <section className="panel">
        <div className="table-wrap"><table><thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Two-step</th><th>Last sign-in</th><th /></tr></thead><tbody>
          {list.map((s) => (
            <tr key={s.id}><td>{s.name || '–'}</td><td>{s.email}</td><td>{s.role}</td><td>{s.totpEnabled ? <span className="flag info">On</span> : <span className="flag warn">Off</span>}</td><td>{ago(s.lastLoginAt)}</td>
              <td style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {s.id !== me.id && <form action={setStaffActiveAction}><input type="hidden" name="id" value={s.id} /><input type="hidden" name="active" value={s.active ? '0' : '1'} /><button className={'btn sm' + (s.active ? ' danger' : '')}>{s.active ? 'Disable' : 'Enable'}</button></form>}
                <ResetForm id={s.id} />
              </td></tr>
          ))}</tbody></table></div>
      </section>
      <StaffForm />
    </>
  );
}
