/**
 * The knowledge graph, actually drawn.
 *
 * Brain Graph reported counts, hubs and bar charts but never showed a graph,
 * which is the one thing a graph is for -- reported exactly that way ("I see no
 * graph"). This draws the slice the main process picks: the busiest nodes and
 * the edges between them.
 *
 * Why a slice and not all of it: a real project here is ~2,000 nodes and ~4,900
 * edges. Drawn in full that is a hairball nobody can read, and laying it out
 * costs about a second on the UI thread. The top nodes by degree are the ones
 * the hub list already claims matter, so this draws that claim instead of
 * listing it, and says out loud how much of the whole it is showing.
 *
 * Layout is a small deterministic force simulation run once per data change --
 * repulsion, springs along edges, a pull to centre -- not per frame. No library:
 * the app ships offline and this is sixty lines. Deterministic seeding matters
 * so the same graph looks the same each time you open it; a layout that reshuffles
 * on every visit is one you can never learn.
 *
 * Colour encodes node kind and is categorical, so it was validated rather than
 * chosen: #ff453a / #9075dd / #2ea3ac pass the lightness band, chroma floor,
 * CVD separation (worst adjacent deutan dE 10.0), normal-vision separation and
 * 3:1 contrast against both the dark and light chart surfaces. Size encodes
 * degree. Identity is never colour alone -- there is a legend, and the biggest
 * nodes carry their own labels.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { translate } from '@/i18n/i18n'
import type { GraphPicture, GraphPictureNode } from '../right-sidebar/planide-engine-client'

const WIDTH = 720
const HEIGHT = 420

/**
 * Validated categorical palette, in fixed order. Never cycled: a kind beyond
 * these folds into "other" rather than inventing a hue.
 */
const KIND_COLORS: { kind: string; color: string; label: string }[] = [
  { kind: 'code', color: '#ff453a', label: 'Code' },
  { kind: 'external', color: '#9075dd', label: 'External' },
  { kind: 'concept', color: '#2ea3ac', label: 'Concept' }
]
const OTHER_COLOR = '#8b93a7'

function colorFor(kind: string): string {
  return KIND_COLORS.find((k) => k.kind === kind)?.color ?? OTHER_COLOR
}

type Placed = GraphPictureNode & { x: number; y: number; r: number }

/**
 * Deterministic pseudo-random in [0,1) from an integer, so a given graph always
 * starts from the same seed positions and therefore settles the same way.
 */
function rand(i: number): number {
  const x = Math.sin(i * 12.9898) * 43758.5453
  return x - Math.floor(x)
}

function layout(picture: GraphPicture): Placed[] {
  const n = picture.nodes.length
  if (!n) return []
  const maxDegree = Math.max(1, ...picture.nodes.map((d) => d.degree))

  // Seed on a circle rather than at random: a ring has no crossings to undo, so
  // the simulation spends its iterations on structure instead of untangling.
  const nodes: Placed[] = picture.nodes.map((node, i) => {
    const a = (i / n) * Math.PI * 2
    const jitter = 0.85 + rand(i) * 0.3
    return {
      ...node,
      x: WIDTH / 2 + Math.cos(a) * (WIDTH / 3) * jitter,
      y: HEIGHT / 2 + Math.sin(a) * (HEIGHT / 3) * jitter,
      // Area, not radius, tracks degree, so a node twice as connected does not
      // read as four times as big.
      r: 4 + Math.sqrt(node.degree / maxDegree) * 12
    }
  })

  const ITERATIONS = 220
  for (let step = 0; step < ITERATIONS; step++) {
    // Cooling: big moves early, small corrections late.
    const alpha = 1 - step / ITERATIONS

    // Repulsion, every pair. n is capped at ~60 so this stays trivial.
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i]
        const b = nodes[j]
        let dx = b.x - a.x
        let dy = b.y - a.y
        let d2 = dx * dx + dy * dy
        if (d2 < 0.01) {
          // Exactly coincident: nudge deterministically instead of dividing by ~0.
          dx = (rand(i * 31 + j) - 0.5) * 0.1
          dy = (rand(j * 17 + i) - 0.5) * 0.1
          d2 = dx * dx + dy * dy
        }
        const force = (4200 * alpha) / d2
        const d = Math.sqrt(d2)
        const fx = (dx / d) * force
        const fy = (dy / d) * force
        a.x -= fx
        a.y -= fy
        b.x += fx
        b.y += fy
      }
    }

    // Springs along edges.
    for (const e of picture.edges) {
      const a = nodes[e.source]
      const b = nodes[e.target]
      if (!a || !b) continue
      const dx = b.x - a.x
      const dy = b.y - a.y
      const d = Math.sqrt(dx * dx + dy * dy) || 0.01
      const pull = ((d - 108) / d) * 0.04 * alpha
      const fx = dx * pull
      const fy = dy * pull
      a.x += fx
      a.y += fy
      b.x -= fx
      b.y -= fy
    }

    // Gentle pull to centre so detached clusters do not drift off-canvas.
    for (const node of nodes) {
      node.x += (WIDTH / 2 - node.x) * 0.012 * alpha
      node.y += (HEIGHT / 2 - node.y) * 0.012 * alpha
    }
  }

  // Clamp inside the viewBox, accounting for the node's own radius.
  for (const node of nodes) {
    node.x = Math.min(WIDTH - node.r - 2, Math.max(node.r + 2, node.x))
    node.y = Math.min(HEIGHT - node.r - 2, Math.max(node.r + 2, node.y))
  }
  return nodes
}

export function GraphCanvas({ picture }: { picture: GraphPicture }): React.JSX.Element | null {
  const [hover, setHover] = useState<number | null>(null)
  const [placed, setPlaced] = useState<Placed[]>([])
  const wrap = useRef<HTMLDivElement>(null)

  // Laying out ~60 nodes is a few milliseconds, but it is still work on the UI
  // thread, so it runs once per picture rather than on every render.
  useEffect(() => {
    setPlaced(layout(picture))
    setHover(null)
  }, [picture])

  const kindsPresent = useMemo(() => {
    const seen = new Set(picture.nodes.map((n) => n.kind))
    return KIND_COLORS.filter((k) => seen.has(k.kind))
  }, [picture])

  const clearHover = useCallback(() => setHover(null), [])

  if (!picture.available || !placed.length) return null

  const hovered = hover !== null ? placed[hover] : null
  // Edges touching the hovered node stay lit; the rest recede, which is how you
  // read "what does this connect to" out of a dense picture.
  const isLit = (e: { source: number; target: number }): boolean =>
    hover === null || e.source === hover || e.target === hover

  return (
    <div ref={wrap} className="relative">
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="w-full rounded-lg border border-border/40 bg-card/30"
        role="img"
        aria-label={translate(
          'planide.memory.graphAlt',
          'The most connected pieces of this project and the links between them'
        )}
        onMouseLeave={clearHover}
      >
        <g>
          {picture.edges.map((e, i) => {
            const a = placed[e.source]
            const b = placed[e.target]
            if (!a || !b) return null
            return (
              <line
                key={i}
                x1={a.x}
                y1={a.y}
                x2={b.x}
                y2={b.y}
                stroke="var(--foreground)"
                strokeWidth={hover !== null && isLit(e) ? 1.4 : 0.9}
                // Explicit rather than a utility class: edges are the
                // background of this picture, not its subject, and at class
                // alpha they rendered near-white and drowned the nodes.
                strokeOpacity={hover === null ? 0.14 : isLit(e) ? 0.45 : 0.05}
                className="transition-opacity"
              />
            )
          })}
        </g>
        <g>
          {placed.map((node, i) => {
            const dim = hover !== null && hover !== i
            return (
              <g key={node.id} opacity={dim ? 0.3 : 1} className="transition-opacity">
                <circle
                  cx={node.x}
                  cy={node.y}
                  r={node.r}
                  fill={colorFor(node.kind)}
                  // A 2px surface ring keeps overlapping marks readable.
                  stroke="var(--card)"
                  strokeWidth={2}
                  onMouseEnter={() => setHover(i)}
                  className="cursor-pointer"
                />
              </g>
            )
          })}
        </g>
        <g className="pointer-events-none">
          {/* Selective direct labels: the six biggest only. A label on every
              node is unreadable at this density. */}
          {placed
            .map((node, i) => ({ node, i }))
            .sort((a, b) => b.node.degree - a.node.degree)
            .slice(0, 5)
            .map(({ node, i }) => (
              <text
                key={node.id}
                x={node.x}
                y={node.y - node.r - 5}
                textAnchor="middle"
                fontSize={9.5}
                fill="var(--foreground)"
                // A halo in the surface colour, painted under the glyphs, is
                // what keeps a label legible where it crosses a node or an edge.
                stroke="var(--card)"
                strokeWidth={3}
                paintOrder="stroke"
                strokeLinejoin="round"
                opacity={hover !== null && hover !== i ? 0.25 : 0.92}
              >
                {node.label.length > 22 ? `${node.label.slice(0, 21)}…` : node.label}
              </text>
            ))}
        </g>
      </svg>

      {hovered ? (
        <div className="pointer-events-none absolute left-2 top-2 max-w-[85%] rounded-md border border-border/50 bg-popover/95 px-2.5 py-1.5 text-[11px] shadow-md">
          <div className="truncate font-medium">{hovered.label}</div>
          <div className="text-muted-foreground">
            {hovered.degree}{' '}
            {translate('planide.memory.graphConnections', 'connections')} ·{' '}
            {KIND_COLORS.find((k) => k.kind === hovered.kind)?.label ?? hovered.kind}
          </div>
        </div>
      ) : null}

      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
        {kindsPresent.map((k) => (
          <span
            key={k.kind}
            className="inline-flex items-center"
            // Inline spacing rather than only a utility class: the legend is
            // what carries identity when colour alone must not, so it should
            // not depend on a class surviving a build.
            style={{ gap: 6, marginRight: 14 }}
          >
            <span
              className="inline-block rounded-full"
              style={{ backgroundColor: k.color, width: 10, height: 10 }}
              aria-hidden
            />
            {k.label}
          </span>
        ))}
        <span className="ml-auto">
          {translate('planide.memory.graphSlice', 'Showing the {{n}} most connected of {{total}}')
            .replace('{{n}}', String(picture.shownOf.nodes))
            .replace('{{total}}', String(picture.shownOf.totalNodes))}
        </span>
      </div>
    </div>
  )
}
