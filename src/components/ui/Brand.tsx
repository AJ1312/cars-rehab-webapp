export function Mark({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 512 512" aria-hidden="true" focusable="false">
      <rect width="512" height="512" rx="112" fill="#141B2D" />
      <circle cx="256" cy="262" r="176" fill="none" stroke="#F6F1E7" strokeWidth="13" strokeDasharray="1 33" strokeLinecap="round" />
      <path d="M256 96 L164 236 L256 262 Z" fill="#FF8A00" />
      <path d="M256 96 L348 236 L256 262 Z" fill="#E86400" />
      <path d="M256 96 L348 236 L256 262 L164 236 Z" fill="none" stroke="#F6F1E7" strokeWidth="14" strokeLinejoin="round" />
      <circle cx="256" cy="392" r="40" fill="none" stroke="#8CA4FF" strokeWidth="14" />
      <circle cx="256" cy="392" r="10" fill="#FFC400" />
    </svg>
  );
}
export function Brand({ small }: { small?: boolean }) {
  return <span className="brand"><Mark size={small ? 28 : 34} /> CARS Rehab</span>;
}
