/**
 * The PlanIDE mark.
 *
 * Two forms, deliberately:
 *
 *  * `PlanIdeMark` — the glyph, drawn in `currentColor` on lucide's 24×24 stroke
 *    grid. It goes wherever Orca puts an icon (left nav, activity bar, tabs), so
 *    it inherits the exact active/inactive/hover colours those places already
 *    apply. Orca has this pattern itself for its non-lucide tab icon
 *    (`agent-session-history-icon.tsx`); this follows it rather than inventing
 *    a second convention.
 *  * `PlanIdeLogo` — the full badge, brand colours and all, for the one or two
 *    places a logo belongs (the workbench header, the empty state). Gradient ids
 *    are per-instance via `useId`, so two logos on one page cannot collide.
 *
 * The shape is the radar from the app icon: rings, a sweep, and a contact.
 * Something is being watched — which is the whole point of the tracker.
 */

import React, { useId } from 'react'

export function PlanIdeMark({
  size = 16,
  className,
  strokeWidth = 2
}: {
  size?: number
  className?: string
  strokeWidth?: number
}): React.JSX.Element {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className={className}
    >
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="4.25" />
      {/* the sweep, out to the rim */}
      <path d="M12 12 18.2 5.8" />
      {/* the contact it found */}
      <circle cx="15.9" cy="14.6" r="1.5" fill="currentColor" stroke="none" />
    </svg>
  )
}

export function PlanIdeLogo({
  size = 28,
  className
}: {
  size?: number
  className?: string
}): React.JSX.Element {
  const uid = useId().replace(/:/g, '')
  const bg = `pi-bg-${uid}`
  const sweep = `pi-sweep-${uid}`
  const glow = `pi-glow-${uid}`
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 128 128"
      fill="none"
      aria-hidden
      className={className}
    >
      <defs>
        <linearGradient id={bg} x1="0" y1="0" x2="128" y2="128" gradientUnits="userSpaceOnUse">
          <stop stopColor="#141826" />
          <stop offset="1" stopColor="#0a0b12" />
        </linearGradient>
        <linearGradient id={sweep} x1="64" y1="64" x2="112" y2="30" gradientUnits="userSpaceOnUse">
          <stop stopColor="#ff453a" stopOpacity="0.9" />
          <stop offset="1" stopColor="#ff453a" stopOpacity="0" />
        </linearGradient>
        <radialGradient id={glow} cx="0.5" cy="0.5" r="0.5">
          <stop stopColor="#ff453a" stopOpacity="0.28" />
          <stop offset="1" stopColor="#ff453a" stopOpacity="0" />
        </radialGradient>
      </defs>

      <rect
        x="4"
        y="4"
        width="120"
        height="120"
        rx="28"
        fill={`url(#${bg})`}
        stroke="#ffffff"
        strokeOpacity="0.08"
        strokeWidth="1.5"
      />
      <circle cx="64" cy="64" r="44" fill={`url(#${glow})`} />

      <circle cx="64" cy="64" r="40" stroke="#b39bff" strokeOpacity="0.3" strokeWidth="2" />
      <circle cx="64" cy="64" r="27" stroke="#b39bff" strokeOpacity="0.22" strokeWidth="2" />
      <circle cx="64" cy="64" r="14" stroke="#b39bff" strokeOpacity="0.16" strokeWidth="2" />

      <line x1="16" y1="64" x2="112" y2="64" stroke="#8a93a8" strokeOpacity="0.18" strokeWidth="1.5" />
      <line x1="64" y1="16" x2="64" y2="112" stroke="#8a93a8" strokeOpacity="0.18" strokeWidth="1.5" />

      <path d="M64 64 L112 40 A44 44 0 0 0 92 26 Z" fill={`url(#${sweep})`} />

      {/* the contact the sweep found, with the check that says you confirmed it */}
      <circle cx="90" cy="44" r="12" fill="#0a0b12" stroke="#32d583" strokeWidth="2.5" />
      <path
        d="M85 44.5 L88.5 48 L95 40.5"
        stroke="#32d583"
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />

      <circle cx="64" cy="64" r="5.5" fill="#ff453a" />
      <circle cx="64" cy="64" r="10" stroke="#ff453a" strokeOpacity="0.5" strokeWidth="1.5" />
    </svg>
  )
}
