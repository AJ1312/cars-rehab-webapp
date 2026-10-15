import { requireStaff } from '@/lib/server/auth';
import { getStore } from '@/lib/server/store';
import { SettingsForm } from '@/components/admin/Forms';

export const metadata = { title: 'Settings' };

export default async function Settings() {
  await requireStaff('admin');
  const v = await getStore().getSettings();
  return (
    <>
      <div><h1>Study settings</h1><p className="sub">Defaults for every study phone.</p></div>
      <SettingsForm v={v} />
    </>
  );
}
