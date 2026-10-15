import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { currentStaff } from '@/lib/server/auth';
import { LoginForm } from '@/components/admin/LoginForm';
import { Brand } from '@/components/ui/Brand';

export const metadata: Metadata = { title: 'Sign in' };
export const dynamic = 'force-dynamic';

export default async function LoginPage() {
  if (await currentStaff()) redirect('/admin');
  return (
    <div className="login">
      <Brand />
      <h1>Admin board</h1>
      <p className="muted">Sign in with your study account. Participants’ data is only visible to signed-in staff.</p>
      <LoginForm />
    </div>
  );
}
