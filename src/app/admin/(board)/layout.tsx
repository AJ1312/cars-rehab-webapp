import type { Metadata } from 'next';
import Link from 'next/link';
import { requireStaff, atLeast } from '@/lib/server/auth';
import { Brand } from '@/components/ui/Brand';
import { NavLinks } from '@/components/admin/NavLinks';
import { SignOut } from '@/components/admin/SignOut';

export const metadata: Metadata = { title: { default: 'Admin board', template: '%s · CARS admin' }, robots: { index: false, follow: false } };

export default async function BoardLayout({ children }: { children: React.ReactNode }) {
  const staff = await requireStaff();
  const items = [
    { href: '/admin', label: 'Overview' }, { href: '/admin/participants', label: 'Participants' }, { href: '/admin/sessions', label: 'Sessions' },
    { href: '/admin/quality', label: 'Data quality' },
    ...(atLeast(staff, 'researcher') ? [{ href: '/admin/exports', label: 'Exports' }] : []),
    ...(staff.role === 'admin' ? [{ href: '/admin/devices', label: 'Phones' }, { href: '/admin/staff', label: 'Staff' }, { href: '/admin/settings', label: 'Settings' }, { href: '/admin/audit', label: 'Audit log' }] : []),
    { href: '/admin/account', label: 'My account' }
  ];
  return (
    <div className="adm">
      <header className="adm-top">
        <Link href="/admin" style={{ textDecoration: 'none', color: 'inherit' }}><Brand /></Link>
        <div className="adm-who"><span>{staff.name || staff.email} · {staff.role}</span><Link className="btn sm" href="/">Play app</Link><SignOut /></div>
      </header>
      <NavLinks items={items} />
      <main id="main" style={{ display: 'grid', gap: 20, minWidth: 0 }}>{children}</main>
    </div>
  );
}
