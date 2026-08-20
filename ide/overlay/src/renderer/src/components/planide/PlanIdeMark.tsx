/**
 * The PulsarIDE mark.
 *
 * Two forms, deliberately:
 *
 *  * `PlanIdeMark` — the glyph, drawn in `currentColor` on lucide's 24×24 stroke
 *    grid. It goes wherever the IDE puts an icon (left nav, activity bar, tabs),
 *    so it inherits the exact active/inactive/hover colours those places apply.
 *    Orca has this pattern itself for its non-lucide tab icon
 *    (`agent-session-history-icon.tsx`); this follows it.
 *  * `PlanIdeLogo` — the full badge, brand colours and all, for the one or two
 *    places a logo belongs (the workbench empty state). Gradient ids are
 *    per-instance via `useId`, so two logos on one page cannot collide.
 *
 * The shape is a pulsar: a neutron-star core with two relativistic beams
 * sweeping from the poles and pulse rings seen edge-on. The name is the picture.
 *
 * (The component and its exports keep the `PlanIde*` names — they are internal
 * identifiers no user sees, and renaming them across the overlay would be churn
 * with no visible payoff. The product's visible name is PulsarIDE.)
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
      {/* pulse ring, edge-on */}
      <ellipse cx="12" cy="12" rx="9.5" ry="3.4" transform="rotate(-40 12 12)" opacity="0.55" />
      {/* the twin beams */}
      <path d="M12 12 20.5 5" />
      <path d="M12 12 3.5 19" />
      {/* the core */}
      <circle cx="12" cy="12" r="3.1" fill="currentColor" stroke="none" />
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
  const bg = `pu-bg-${uid}`
  const core = `pu-core-${uid}`
  const halo = `pu-halo-${uid}`
  const beamA = `pu-beamA-${uid}`
  const beamB = `pu-beamB-${uid}`
  return (
    <svg width={size} height={size} viewBox="0 0 128 128" fill="none" aria-hidden className={className}>
      <defs>
        <linearGradient id={bg} x1="0" y1="0" x2="128" y2="128" gradientUnits="userSpaceOnUse">
          <stop stopColor="#141826" />
          <stop offset="1" stopColor="#0a0b12" />
        </linearGradient>
        <radialGradient id={core} cx="0.5" cy="0.5" r="0.5">
          <stop stopColor="#ffffff" />
          <stop offset="0.45" stopColor="#c9d8ff" />
          <stop offset="1" stopColor="#6d4fe0" />
        </radialGradient>
        <radialGradient id={halo} cx="0.5" cy="0.5" r="0.5">
          <stop stopColor="#8ab4ff" stopOpacity="0.55" />
          <stop offset="1" stopColor="#6d4fe0" stopOpacity="0" />
        </radialGradient>
        <linearGradient id={beamA} x1="64" y1="64" x2="118" y2="18" gradientUnits="userSpaceOnUse">
          <stop stopColor="#8ab4ff" stopOpacity="0.85" />
          <stop offset="1" stopColor="#38bdf8" stopOpacity="0" />
        </linearGradient>
        <linearGradient id={beamB} x1="64" y1="64" x2="10" y2="110" gradientUnits="userSpaceOnUse">
          <stop stopColor="#b39bff" stopOpacity="0.8" />
          <stop offset="1" stopColor="#b39bff" stopOpacity="0" />
        </linearGradient>
      </defs>

      <rect x="4" y="4" width="120" height="120" rx="28" fill={`url(#${bg})`} stroke="#ffffff" strokeOpacity="0.08" strokeWidth="1.5" />

      <g fill="none">
        <ellipse cx="64" cy="64" rx="44" ry="15" transform="rotate(-38 64 64)" stroke="#b39bff" strokeOpacity="0.16" strokeWidth="2" />
        <ellipse cx="64" cy="64" rx="30" ry="10" transform="rotate(-38 64 64)" stroke="#8ab4ff" strokeOpacity="0.22" strokeWidth="2" />
      </g>

      <path d="M64 64 L120 16 L108 40 Z" fill={`url(#${beamA})`} />
      <path d="M64 64 L8 112 L20 88 Z" fill={`url(#${beamB})`} />
      <line x1="64" y1="64" x2="115" y2="20" stroke="#8ab4ff" strokeWidth="3" strokeLinecap="round" strokeOpacity="0.9" />
      <line x1="64" y1="64" x2="13" y2="108" stroke="#b39bff" strokeWidth="3" strokeLinecap="round" strokeOpacity="0.85" />

      <circle cx="64" cy="64" r="26" fill={`url(#${halo})`} />
      <circle cx="64" cy="64" r="10.5" fill={`url(#${core})`} />
      <circle cx="64" cy="64" r="10.5" stroke="#ffffff" strokeOpacity="0.5" strokeWidth="1" />
    </svg>
  )
}
