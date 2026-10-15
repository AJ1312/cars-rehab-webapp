/* Illustrations drawn from the things the participant actually sees: the phone, the ring, the triangles, the number discs.
 * Flat colour, ink outlines, a hard offset shadow: the same language as the buttons. Strokes follow the theme ink. */
const INK = 'var(--ink)';
const FONT = "'Bricolage Grotesque Variable', 'Atkinson Hyperlegible', sans-serif";

function Tri({ x, y, s = 1, hue = '#FF8A00', dark = '#E86400' }: { x: number; y: number; s?: number; hue?: string; dark?: string }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${s})`}>
      <path d="M0 -26 L-21 10 L0 20 Z" fill={hue} /><path d="M0 -26 L21 10 L0 20 Z" fill={dark} />
      <path d="M0 -26 L21 10 L0 20 L-21 10 Z" fill="none" stroke={INK} strokeWidth="4" strokeLinejoin="round" />
      <path d="M-21 10 L0 20 L21 10" fill="none" stroke={INK} strokeWidth="4" strokeLinejoin="round" />
    </g>
  );
}
function Disc({ x, y, r = 20, fill = '#FFC400', n }: { x: number; y: number; r?: number; fill?: string; n: string }) {
  return (
    <g>
      <circle cx={x} cy={y} r={r} fill={fill} stroke={INK} strokeWidth="4" />
      <text x={x} y={y + r * 0.36} textAnchor="middle" fontSize={r * 1.15} fontWeight="800" fill="#141B2D" fontFamily={FONT}>{n}</text>
    </g>
  );
}

/** Hero: a phone on an outstretched arm reaching for floating triangles. */
export function ArtHero() {
  return (
    <svg viewBox="0 0 220 150" aria-hidden="true" focusable="false">
      <path d="M64 134 C 82 126, 100 114, 118 100" fill="none" stroke="#F6F1E7" strokeWidth="2.5" strokeDasharray="1 9" strokeLinecap="round" />
      <Tri x={170} y={32} s={1.05} />
      <Tri x={198} y={92} s={0.7} hue="#8CA4FF" dark="#5B77F0" />
      <Tri x={116} y={30} s={0.62} hue="#19B36B" dark="#0E8A50" />
      <g transform="translate(78 62) rotate(-18)">
        <rect x="0" y="0" width="44" height="76" rx="9" fill="#F6F1E7" stroke="#141B2D" strokeWidth="4" />
        <rect x="6" y="8" width="32" height="56" rx="3" fill="#141B2D" />
        <circle cx="22" cy="14" r="3" fill="#FFC400" />
        <circle cx="22" cy="40" r="10" fill="none" stroke="#8CA4FF" strokeWidth="3" /><circle cx="22" cy="40" r="2.4" fill="#FFC400" />
        <rect x="-6" y="30" width="56" height="9" rx="4" fill="#FF8A00" stroke="#141B2D" strokeWidth="3.5" />
      </g>
    </svg>
  );
}

export function ArtGuide() {
  return (
    <svg viewBox="0 0 120 96" aria-hidden="true" focusable="false">
      <rect x="14" y="12" width="76" height="72" rx="10" fill="#FFFDF8" stroke="#141B2D" strokeWidth="4" />
      <path d="M14 30 H90" stroke="#141B2D" strokeWidth="4" />
      <rect x="26" y="40" width="34" height="6" rx="3" fill="#141B2D" /><rect x="26" y="54" width="48" height="6" rx="3" fill="#141B2D" opacity=".35" /><rect x="26" y="66" width="40" height="6" rx="3" fill="#141B2D" opacity=".35" />
      <circle cx="92" cy="26" r="20" fill="#2447E8" stroke="#141B2D" strokeWidth="4" />
      <text x="92" y="35" textAnchor="middle" fontSize="26" fontWeight="800" fill="#fff" fontFamily={FONT}>?</text>
    </svg>
  );
}

export function ArtTry() {
  return (
    <svg viewBox="0 0 120 96" aria-hidden="true" focusable="false">
      <Tri x={40} y={44} s={1.25} />
      <circle cx="82" cy="34" r="22" fill="none" stroke={INK} strokeWidth="3.5" strokeDasharray="2 7" strokeLinecap="round" />
      <path d="M72 28 L96 40 L80 44 L76 60 Z" fill="#FFC400" stroke={INK} strokeWidth="3.5" strokeLinejoin="round" />
    </svg>
  );
}

export function ArtPhone() {
  return (
    <svg viewBox="0 0 120 96" aria-hidden="true" focusable="false">
      <g transform="translate(34 6)">
        <rect x="0" y="0" width="52" height="84" rx="11" fill="#141B2D" stroke="#F6F1E7" strokeWidth="4" />
        <rect x="7" y="11" width="38" height="62" rx="4" fill="#25305A" />
        <circle cx="26" cy="6" r="2.4" fill="#F6F1E7" opacity=".7" />
        <circle cx="26" cy="42" r="13" fill="none" stroke="#19B36B" strokeWidth="3.5" strokeDasharray="3 5" strokeLinecap="round" />
        <path d="M26 34 L19 47 L33 47 Z" fill="#FF8A00" stroke="#F6F1E7" strokeWidth="2.5" strokeLinejoin="round" />
      </g>
    </svg>
  );
}

export function ArtUploads() {
  return (
    <svg viewBox="0 0 120 96" aria-hidden="true" focusable="false">
      <path d="M30 70 a22 22 0 0 1 4 -43 a28 28 0 0 1 54 8 a18 18 0 0 1 -2 35 Z" fill="#FFFDF8" stroke={INK} strokeWidth="4" strokeLinejoin="round" />
      <path d="M60 80 V44 M46 56 L60 42 L74 56" fill="none" stroke="#2447E8" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function ArtLock() {
  return (
    <svg viewBox="0 0 120 96" aria-hidden="true" focusable="false">
      <rect x="30" y="42" width="60" height="44" rx="10" fill="#FFC400" stroke={INK} strokeWidth="4" />
      <path d="M42 42 V32 a18 18 0 0 1 36 0 V42" fill="none" stroke={INK} strokeWidth="5" strokeLinecap="round" />
      <circle cx="60" cy="62" r="5" fill={INK} /><rect x="57.5" y="64" width="5" height="12" rx="2.5" fill={INK} />
    </svg>
  );
}

/* ---------- Guide illustrations ---------- */

/** Phone strapped to the back of the hand, forearm resting on a table edge. */
export function ArtStrap() {
  return (
    <svg viewBox="0 0 280 150" aria-hidden="true" focusable="false">
      <rect x="6" y="104" width="268" height="12" rx="4" fill={INK} opacity=".15" />
      <path d="M14 78 C 46 70, 96 70, 140 74 L 170 78 C 188 80, 196 92, 190 104 C 184 114, 170 116, 150 112 L 14 108 Z" fill="#F2C9A5" stroke={INK} strokeWidth="4" strokeLinejoin="round" />
      <path d="M190 84 C 214 74, 240 78, 252 90 C 258 98, 250 106, 238 104 L 196 102" fill="#F2C9A5" stroke={INK} strokeWidth="4" strokeLinejoin="round" />
      <g transform="translate(104 34) rotate(8)">
        <rect x="0" y="0" width="62" height="88" rx="12" fill="#141B2D" stroke={INK} strokeWidth="4" />
        <rect x="7" y="12" width="48" height="66" rx="4" fill="#25305A" />
        <circle cx="31" cy="6" r="2.6" fill="#F6F1E7" opacity=".7" />
        <path d="M18 62 L31 38 L44 62 Z" fill="#FF8A00" stroke="#F6F1E7" strokeWidth="3" strokeLinejoin="round" />
      </g>
      <path d="M96 76 H 186" stroke="#FF8A00" strokeWidth="11" strokeLinecap="round" /><path d="M96 76 H 186" stroke={INK} strokeWidth="3" strokeDasharray="2 8" strokeLinecap="round" />
      <path d="M100 100 H 182" stroke="#FF8A00" strokeWidth="11" strokeLinecap="round" /><path d="M100 100 H 182" stroke={INK} strokeWidth="3" strokeDasharray="2 8" strokeLinecap="round" />
      <text x="140" y="142" textAnchor="middle" fontSize="13" fontWeight="700" fill="var(--muted)" fontFamily={FONT}>Strap over the back of the hand</text>
    </svg>
  );
}

/** Hold the phone at chest height, ring in the middle of the screen. */
export function ArtHold() {
  return (
    <svg viewBox="0 0 280 150" aria-hidden="true" focusable="false">
      <circle cx="70" cy="40" r="17" fill="#F2C9A5" stroke={INK} strokeWidth="4" />
      <path d="M44 132 V86 a26 26 0 0 1 52 0 V132" fill="#2447E8" stroke={INK} strokeWidth="4" strokeLinejoin="round" />
      <path d="M92 94 L 150 80" stroke={INK} strokeWidth="9" strokeLinecap="round" /><path d="M92 94 L 150 80" stroke="#F2C9A5" strokeWidth="4.5" strokeLinecap="round" />
      <g transform="translate(146 52) rotate(-4)">
        <rect x="0" y="0" width="40" height="64" rx="8" fill="#141B2D" stroke={INK} strokeWidth="4" />
        <circle cx="20" cy="32" r="9" fill="none" stroke="#19B36B" strokeWidth="3.5" />
      </g>
      <path d="M196 84 C 226 84, 232 60, 256 48" fill="none" stroke={INK} strokeWidth="3" strokeDasharray="2 8" strokeLinecap="round" />
      <Tri x={248} y={38} s={0.7} />
      <path d="M20 148 H 260" stroke={INK} strokeWidth="3" opacity=".25" />
      <text x="140" y="146" textAnchor="middle" fontSize="13" fontWeight="700" fill="var(--muted)" fontFamily={FONT}>Chest height, elbow comfortable</text>
    </svg>
  );
}

/** Five seconds of back-and-forth movement to start tracking. */
export function ArtInit() {
  return (
    <svg viewBox="0 0 280 120" aria-hidden="true" focusable="false">
      <g transform="translate(116 22)">
        <rect x="0" y="0" width="48" height="78" rx="10" fill="#141B2D" stroke={INK} strokeWidth="4" />
        <rect x="6" y="10" width="36" height="58" rx="4" fill="#25305A" />
        <circle cx="24" cy="39" r="11" fill="none" stroke="#FFC400" strokeWidth="3.5" strokeDasharray="4 5" />
      </g>
      <path d="M96 60 H 30 M44 46 L28 60 L44 74" fill="none" stroke="#2447E8" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M184 60 H 250 M236 46 L252 60 L236 74" fill="none" stroke="#2447E8" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" />
      <text x="140" y="114" textAnchor="middle" fontSize="13" fontWeight="700" fill="var(--muted)" fontFamily={FONT}>5 seconds, left and right</text>
    </svg>
  );
}

/** The play screen, as in the paper's Figure 2: score top left, timer top right, the question in the middle, answers around it. */
export function ArtScreen({ game }: { game: 'triangle' | 'maths' | 'colour' }) {
  return (
    <svg viewBox="0 0 180 300" aria-hidden="true" focusable="false">
      <rect x="4" y="4" width="172" height="292" rx="22" fill="#141B2D" stroke={INK} strokeWidth="4" />
      <rect x="12" y="14" width="152" height="272" rx="12" fill="#25305A" />
      <rect x="18" y="20" width="48" height="26" rx="8" fill="#141B2D" stroke="#F6F1E7" strokeWidth="2.5" /><text x="42" y="40" textAnchor="middle" fontSize="16" fontWeight="800" fill="#FFC400" fontFamily={FONT}>3</text>
      <rect x="114" y="20" width="48" height="26" rx="8" fill="#141B2D" stroke="#F6F1E7" strokeWidth="2.5" /><text x="138" y="40" textAnchor="middle" fontSize="13" fontWeight="800" fill="#F6F1E7" fontFamily={FONT}>1:12</text>
      {game === 'triangle' && (
        <g>
          <Tri x={46} y={92} s={0.8} /><Tri x={126} y={134} s={0.8} hue="#8CA4FF" dark="#5B77F0" /><Tri x={52} y={216} s={0.8} hue="#19B36B" dark="#0E8A50" /><Tri x={128} y={250} s={0.8} />
          <circle cx="90" cy="165" r="12" fill="none" stroke="#F6F1E7" strokeWidth="3" strokeDasharray="2 5" />
        </g>
      )}
      {game === 'maths' && (
        <g>
          <Disc x={44} y={84} r={17} n="4" /><Disc x={130} y={110} r={17} fill="#FF9EC8" n="2" /><Disc x={48} y={228} r={17} fill="#C7B8FF" n="6" /><Disc x={132} y={246} r={17} n="5" />
          <text x="90" y="170" textAnchor="middle" fontSize="22" fontWeight="800" fill="#fff" fontFamily={FONT}>8 − 4 = ?</text>
        </g>
      )}
      {game === 'colour' && (
        <g fontFamily={FONT} fontWeight="800" textAnchor="middle">
          <rect x="22" y="76" width="64" height="22" rx="11" fill="#141B2D" /><text x="54" y="92" fontSize="13" fill="#FF4B3E">BLUE</text>
          <rect x="96" y="104" width="66" height="22" rx="11" fill="#141B2D" /><text x="129" y="120" fontSize="13" fill="#2FD06A">RED</text>
          <rect x="22" y="212" width="66" height="22" rx="11" fill="#141B2D" /><text x="55" y="228" fontSize="13" fill="#4D9BFF">GREEN</text>
          <rect x="96" y="244" width="66" height="22" rx="11" fill="#141B2D" /><text x="129" y="260" fontSize="13" fill="#FFD43B">YELLOW</text>
          <text x="90" y="170" fontSize="24" fill="#fff">BLUE</text>
        </g>
      )}
    </svg>
  );
}

/** Close, Medium and Far: how big and how spread out the objects are on the screen. */
export function ArtDistance({ kind }: { kind: 'near' | 'medium' | 'far' }) {
  const s = kind === 'near' ? 0.62 : kind === 'medium' ? 0.5 : 0.4;
  const pts: [number, number][] = kind === 'near' ? [[30, 34], [54, 38], [34, 66], [52, 70]] : kind === 'medium' ? [[22, 26], [58, 32], [24, 72], [56, 76]] : [[14, 20], [66, 24], [16, 82], [64, 86]];
  return (
    <svg viewBox="0 0 80 104" aria-hidden="true" focusable="false">
      <rect x="3" y="3" width="74" height="98" rx="10" fill="none" stroke="currentColor" strokeWidth="3.5" />
      {pts.map(([x, y], i) => <Tri key={i} x={x} y={y} s={s} hue={['#FF8A00', '#8CA4FF', '#19B36B', '#FFC400'][i]} dark={['#E86400', '#5B77F0', '#0E8A50', '#E0A800'][i]} />)}
    </svg>
  );
}

export function ArtSize({ kind }: { kind: 'small' | 'medium' | 'large' }) {
  const s = kind === 'small' ? 0.6 : kind === 'medium' ? 0.85 : 1.15;
  return (
    <svg viewBox="0 0 80 64" aria-hidden="true" focusable="false"><Tri x={40} y={32} s={s} /></svg>
  );
}

/** How the games follow each other. Each colour is a game. */
export function ArtOrder({ mode }: { mode: 'random' | 'fixed' | 'rotate' | 'mixed' }) {
  const C = ['#FF8A00', '#FFC400', '#4D9BFF'];
  const seq: number[] = mode === 'fixed' ? [0, 0, 1, 1, 2, 2] : mode === 'random' ? [1, 1, 2, 2, 0, 0] : mode === 'rotate' ? [2, 2, 0, 0, 1, 1] : [1, 0, 2, 1, 2, 0];
  return (
    <svg viewBox="0 0 96 28" aria-hidden="true" focusable="false">
      {seq.map((c, i) => <rect key={i} x={2 + i * 15.5} y="3" width="13" height="22" rx="4" fill={C[c]} stroke={INK} strokeWidth="2.5" />)}
    </svg>
  );
}

export function IconGuide() { return <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="9.5" fill="none" stroke="currentColor" strokeWidth="2.4" /><path d="M9.2 9.4a2.9 2.9 0 1 1 4.1 2.6c-.9.5-1.3 1-1.3 1.9" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" /><circle cx="12" cy="17.2" r="1.3" fill="currentColor" /></svg>; }
export function IconVibrate() { return <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><rect x="8" y="3" width="8" height="18" rx="2.4" fill="none" stroke="currentColor" strokeWidth="2.2" /><path d="M4 8v8M20 8v8M1.5 10.5v3M22.5 10.5v3" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" /></svg>; }
export function IconSound() { return <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinejoin="round" /><path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" /></svg>; }
