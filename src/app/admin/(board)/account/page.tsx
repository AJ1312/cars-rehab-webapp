import { requireStaff } from '@/lib/server/auth';
import { PasswordForm, TotpPanel } from '@/components/admin/Forms';

export const metadata = { title: 'My account' };

export default async function Account() {
  const me = await requireStaff();
  return (
    <>
      <div><h1>My account</h1><p className="sub">{me.email} · {me.role}</p></div>
      <div className="cols"><TotpPanel enabled={me.totpEnabled} /><PasswordForm /></div>
    </>
  );
}
