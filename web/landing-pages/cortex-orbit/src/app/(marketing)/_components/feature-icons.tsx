type IconProps = { className?: string };

export function LayersGlyph({ className }: IconProps) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <path d="M12 3 3 8l9 5 9-5-9-5Z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
      <path d="m3 12 9 5 9-5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
      <path d="m3 16 9 5 9-5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function SparkGlyph({ className }: IconProps) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <path
        d="M12 3.5c.6 3.4 2.1 5 5.5 5.5-3.4.6-5 2.1-5.5 5.5-.6-3.4-2.1-5-5.5-5.5 3.4-.6 5-2.1 5.5-5.5Z"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
      <path d="M18.5 16.5c.3 1.7 1 2.4 2.5 2.7-1.5.3-2.2 1-2.5 2.7-.3-1.7-1-2.4-2.5-2.7 1.5-.3 2.2-1 2.5-2.7Z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
    </svg>
  );
}

export function ShieldGlyph({ className }: IconProps) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <path
        d="M12 3.5 5 6v5.2c0 4.1 2.9 6.9 7 8.3 4.1-1.4 7-4.2 7-8.3V6l-7-2.5Z"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
      <path d="m9.3 12 1.9 1.9 3.5-3.8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function ScaleGlyph({ className }: IconProps) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <rect x="3.5" y="13.5" width="5" height="7" rx="1" stroke="currentColor" strokeWidth="1.4" />
      <rect x="9.5" y="9" width="5" height="11.5" rx="1" stroke="currentColor" strokeWidth="1.4" />
      <rect x="15.5" y="4" width="5" height="16.5" rx="1" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  );
}
