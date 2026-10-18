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
      <rect width="48" height="48" rx="12" fill="var(--logo-bg, #235b49)" />
      <path d="M10 8h18.5C34.3 8 39 12.7 39 18.5H10V8Z" fill="var(--logo-top, #f7fbf8)" />
      <path d="M25.2 20H39c0 5.8-4.7 10.5-10.5 10.5H20v-5.3c0-2.9 2.3-5.2 5.2-5.2Z" fill="var(--logo-leaf, #9bd2ad)" />
      <path d="M10 30.5h10v4.3c0 2.9-2.3 5.2-5.2 5.2H10v-9.5Z" fill="var(--logo-leaf, #9bd2ad)" />
    </svg>
  );
}
