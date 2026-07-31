/**
 * The kiekie mark: a viewfinder framing a single annotation pin.
 *
 * "kiekie" is a snapshot, and the product is snapshot + one pointed comment —
 * so the mark is a capture frame with a dot at the point of focus. It is drawn
 * on a 32×32 grid with 2px strokes so it stays legible down to a 16px favicon.
 *
 * `size` is the mark's edge length; the wordmark scales with it.
 */
export function LogoMark({ size = 28 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      aria-hidden="true"
      class="logo-mark"
    >
      <defs>
        <linearGradient id="kiekie-mark" x1="0" y1="0" x2="32" y2="32" gradientUnits="userSpaceOnUse">
          <stop offset="0" stop-color="#6d8cff" />
          <stop offset="1" stop-color="#a35cf5" />
        </linearGradient>
      </defs>
      <rect x="0" y="0" width="32" height="32" rx="9" fill="url(#kiekie-mark)" />
      <g stroke="#fff" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round" opacity="0.95">
        <path d="M9 13V10.6A1.6 1.6 0 0 1 10.6 9H13" />
        <path d="M19 9h2.4A1.6 1.6 0 0 1 23 10.6V13" />
        <path d="M23 19v2.4a1.6 1.6 0 0 1-1.6 1.6H19" />
        <path d="M13 23h-2.4A1.6 1.6 0 0 1 9 21.4V19" />
      </g>
      <circle cx="16" cy="16" r="3.4" fill="#fff" />
    </svg>
  );
}

/** Mark plus wordmark, for the top bar and the public share header. */
export function Logo({ size = 28 }: { size?: number }) {
  return (
    <span class="logo">
      <LogoMark size={size} />
      <span class="logo-word">kiekie</span>
    </span>
  );
}
