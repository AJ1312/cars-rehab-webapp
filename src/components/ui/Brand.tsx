export function Mark({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 512 512" aria-hidden="true" focusable="false">
      <rect width="512" height="512" rx="112" fill="#071011" />
      <circle cx="256" cy="256" r="150" fill="none" stroke="#43D3B3" strokeWidth="14" strokeDasharray="3 26" strokeLinecap="round" />
      <circle cx="256" cy="256" r="38" fill="none" stroke="#43D3B3" strokeWidth="14" />
      <path d="M256 98 L316 200 L196 200 Z" fill="#FFB020" stroke="#fff" strokeWidth="12" strokeLinejoin="round" />
    </svg>
  );
}
export function Brand({ small }: { small?: boolean }) {
  return <span className="brand"><Mark size={small ? 24 : 30} /> CARS Rehab</span>;
}
