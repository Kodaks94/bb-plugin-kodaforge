import { useId } from "react";

// The Agent Network's activity-bar icon: a planet with a tilted ring that passes behind it
// and in front of it. Drawn here because BB's icon set has no planet; tints like BB's icons.
export function SaturnIcon({ className }: { className?: string }) {
  const id = useId();
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" aria-hidden="true">
      <defs>
        <mask id={`${id}-back`}>
          <rect width="24" height="24" fill="white" />
          <circle cx="12" cy="12" r="6.6" fill="black" />
        </mask>
        <clipPath id={`${id}-front`}>
          <rect x="0" y="12" width="24" height="12" />
        </clipPath>
      </defs>
      <circle cx="12" cy="12" r="5" />
      <g transform="rotate(-24 12 12)">
        <ellipse cx="12" cy="12" rx="10.5" ry="3.4" mask={`url(#${id}-back)`} />
        <ellipse cx="12" cy="12" rx="10.5" ry="3.4" clipPath={`url(#${id}-front)`} />
      </g>
    </svg>
  );
}
