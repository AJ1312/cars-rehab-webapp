'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

export function NavLinks({ items }: { items: { href: string; label: string }[] }) {
  const path = usePathname();
  return (
    <nav className="adm-nav" aria-label="Admin sections">
      {items.map((i) => {
        const on = i.href === '/admin' ? path === '/admin' : path.startsWith(i.href);
        return <Link key={i.href} href={i.href} aria-current={on ? 'page' : undefined}>{i.label}</Link>;
      })}
    </nav>
  );
}
