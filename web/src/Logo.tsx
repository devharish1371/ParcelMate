export default function Logo({ size = 42 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 48 48"
      fill="none"
      aria-hidden="true"
      className="logo-symbol"
    >
      <rect x="5" y="5" width="38" height="38" rx="11" stroke="currentColor" strokeWidth="2" />
      <path d="M13 19.5h22M24 12v7.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <path d="M16 29h16m-5-5 5 5-5 5" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
