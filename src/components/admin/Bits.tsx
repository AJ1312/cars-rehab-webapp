import Link from 'next/link';
import { FLAG_INFO } from '@/lib/server/ingest';

export function Flags({ flags }: { flags: string[] }) {
  if (!flags.length) return <span className="muted">–</span>;
  return <>{flags.map((f) => { const i = FLAG_INFO[f]; return <span key={f} className={'flag ' + (i?.severity ?? '')} title={i?.help}>{i?.label ?? f}</span>; })}</>;
}
export function Pager({ base, page, pages, params }: { base: string; page: number; pages: number; params: Record<string, string> }) {
  const href = (p: number) => { const u = new URLSearchParams({ ...params, page: String(p) }); return `${base}?${u}`; };
  if (pages <= 1) return null;
  return (
    <nav className="pager" aria-label="Pages">
      {page > 1 ? <Link className="btn sm" href={href(page - 1)}>← Previous</Link> : <span />}
      <span className="muted">Page {page} of {pages}</span>
      {page < pages ? <Link className="btn sm" href={href(page + 1)}>Next →</Link> : <span />}
    </nav>
  );
}
