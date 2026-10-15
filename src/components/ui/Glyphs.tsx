import type { GameKey } from '@/lib/client/engine';

/* The same objects the participant sees in the room, drawn small. */
export function GameGlyph({ g, className = 'glyph' }: { g: GameKey; className?: string }) {
  if (g === 'triangle') {
    return (
      <svg className={className} viewBox="0 0 72 72" aria-hidden="true">
        <path d="M36 9 L14 46 L36 56 Z" fill="#FF8A00" /><path d="M36 9 L58 46 L36 56 Z" fill="#E86400" />
        <path d="M36 9 L58 46 L36 56 L14 46 Z" fill="none" stroke="#141B2D" strokeWidth="4.5" strokeLinejoin="round" />
        <path d="M14 46 L36 56 L58 46" fill="none" stroke="#141B2D" strokeWidth="4.5" strokeLinejoin="round" />
        <ellipse cx="36" cy="64" rx="17" ry="3.6" fill="#141B2D" opacity=".18" />
      </svg>
    );
  }
  if (g === 'maths') {
    return (
      <svg className={className} viewBox="0 0 72 72" aria-hidden="true">
        <circle cx="36" cy="36" r="29" fill="#FFC400" stroke="#141B2D" strokeWidth="4.5" />
        <text x="36" y="47" textAnchor="middle" fontSize="34" fontWeight="800" fill="#141B2D" fontFamily="'Bricolage Grotesque Variable', 'Atkinson Hyperlegible', sans-serif">7</text>
      </svg>
    );
  }
  return (
    <svg className={className} viewBox="0 0 72 72" aria-hidden="true">
      <rect x="4" y="12" width="64" height="22" rx="11" fill="#141B2D" /><rect x="4" y="38" width="64" height="22" rx="11" fill="#141B2D" />
      <text x="36" y="29" textAnchor="middle" fontSize="15" fontWeight="800" fill="#4D9BFF" fontFamily="'Bricolage Grotesque Variable', 'Atkinson Hyperlegible', sans-serif">RED</text>
      <text x="36" y="55" textAnchor="middle" fontSize="15" fontWeight="800" fill="#FF4B3E" fontFamily="'Bricolage Grotesque Variable', 'Atkinson Hyperlegible', sans-serif">BLUE</text>
    </svg>
  );
}

/** Three nested reach arcs; the selected number lights up. */
export function LevelGlyph({ n }: { n: 1 | 2 | 3 }) {
  return (
    <svg viewBox="0 0 56 56" aria-hidden="true">
      <circle cx="28" cy="40" r="3.4" fill="currentColor" />
      {[1, 2, 3].map((i) => <path key={i} d={`M${28 - 7 - i * 6} ${40 - 5 - i * 5} A${10 + i * 6.5} ${10 + i * 6.5} 0 0 1 ${28 + 7 + i * 6} ${40 - 5 - i * 5}`} fill="none" stroke="currentColor" strokeWidth="3.4" strokeLinecap="round" opacity={i <= n ? 1 : 0.22} />)}
    </svg>
  );
}

export function Tick() {
  return <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8.5l3.2 3L13 4.5" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}
