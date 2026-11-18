/** The Adrien mark: a stack of decision records, with the A on the front one. The ink follows the theme's border colour. */
export function BrandMark({ className }: { className?: string }) {
  return (
    <svg viewBox="3 3 118 118" aria-hidden="true" focusable="false" className={className}>
      <g stroke="var(--border)" strokeWidth="5" strokeLinejoin="round">
        <rect x="44" y="8" width="72" height="72" rx="6" fill="#3dd68c" />
        <rect x="26" y="26" width="72" height="72" rx="6" fill="#ff8fb1" />
        <rect x="8" y="44" width="72" height="72" rx="6" fill="#ffd23f" />
        <path
          fill="var(--border)"
          fillRule="evenodd"
          stroke="none"
          transform="translate(8.04 42.8) scale(0.62)"
          d="M58 20 L96 100 H77 L71 86 H45 L39 100 H20 Z M58 60 L64.65 74 H51.35 Z"
        />
      </g>
    </svg>
  );
}
