/**
 * Build the AI briefing: the tracker turned into one structured Markdown
 * document you hand to any agent.
 *
 * Order matters. It leads with what must NOT be broken and with anything that
 * already regressed, because an agent reads top-down and those two facts change
 * what it is allowed to do. "Confirmed by the user" and "reported working" stay
 * separate sections all the way through — an agent must never treat its own
 * predecessor's claim as established fact.
 */

import { cleanText } from './doc-clean'
import { progress, type Item, type ProjectState } from './store'

function bullets(items: Item[], extra?: (i: Item) => string): string[] {
  return items.map((i) => {
    const suffix = extra?.(i)
    return `- ${i.title}${suffix ? ` -- ${suffix}` : ''}`
  })
}

export type ReportMode = 'full' | 'report' | 'prompt'

export function buildReport(state: ProjectState, mode: ReportMode = 'full'): string {
  const p = progress(state)
  const items = state.items ?? []
  const fixes = state.fixes ?? []
  const roadmap = state.roadmap ?? []
  const versions = state.versions ?? []
  const det = state.stack?.detected ?? {}
  const custom = state.stack?.custom ?? ''

  const working = items.filter((i) => i.status === 'works' || i.status === 'done')
  const confirmed = working.filter((i) => i.verified)
  const unconfirmed = working.filter((i) => !i.verified)
  const complete = items.filter((i) => i.status === 'done')
  const broken = items.filter((i) => i.status === 'broken' || i.status === 'blocked')
  const wip = items.filter((i) => i.status === 'wip')
  const todo = items.filter((i) => i.status === 'todo')
  const protectedItems = items.filter((i) => i.locked)
  const regressed = protectedItems.filter((i) => i.status === 'broken' || i.status === 'blocked')
  const openFixes = fixes.filter((f) => f.status === 'open')
  const doneFixes = fixes.filter((f) => f.status === 'fixed')

  const langs = (det.languages ?? []).join(', ') || 'unknown'
  let stack = (det.stack ?? []).join(', ') || '-'
  if (custom) stack = stack === '-' ? custom : `${stack}, ${custom}`

  const L: string[] = []
  L.push(`# ${state.name} -- project briefing`, '')
  L.push(`- **Type**: ${state.type}`)
  L.push(`- **Languages**: ${langs}`)
  L.push(`- **Stack**: ${stack}`)
  L.push(`- **Version**: ${p.version}`)
  L.push(
    `- **Progress**: ${p.percent}% reported working (${p.done}/${p.total_items}); ` +
      `**${p.confirmed_percent}% confirmed by the user** (${p.confirmed}) -- health ${p.health}/100`
  )
  L.push(`- **Open problems**: ${p.broken} broken/blocked, ${p.open_fixes} open fixes`)
  L.push(
    `- **Complete**: ${p.complete} | **Still open**: ${p.open} | ` +
      `**Protected (do not break)**: ${p.protected}`
  )
  if (p.regressed) {
    L.push(`- **REGRESSION**: ${p.regressed} protected item(s) are broken -- fix these first`)
  }
  L.push('')

  if (regressed.length) {
    L.push('## !! REGRESSION -- protected work is broken')
    L.push(
      '_These were marked DO NOT BREAK and are now failing. Fixing them comes before any new work._'
    )
    L.push(...bullets(regressed, (i) => i.notes))
    L.push('')
  }

  if (protectedItems.length) {
    L.push('## DO NOT BREAK (protected by the user)')
    L.push(
      "_Load-bearing and already working. Do not refactor, rename, reformat or 'improve' these " +
        'while doing something else. If a change genuinely requires touching one, stop and ask first._'
    )
    L.push(...bullets(protectedItems))
    L.push('')
  }

  L.push('## What works -- confirmed by the user')
  L.push(...(confirmed.length ? bullets(confirmed) : ['- (nothing confirmed yet)']))
  L.push('')

  if (unconfirmed.length) {
    L.push('## Reported working, NOT yet confirmed')
    L.push('_Treat these as claims, not facts: do not build on them without re-checking._')
    L.push(...bullets(unconfirmed, (i) => (i.claimed_by ? `reported by ${i.claimed_by}` : '')))
    L.push('')
  }

  L.push('## What is broken / blocked')
  L.push(
    ...(broken.length
      ? bullets(broken, (i) => `[${i.status.toUpperCase()}] ${i.notes ?? ''}`.trim())
      : ['- (nothing currently marked broken)'])
  )
  L.push('')

  if (complete.length) {
    L.push('## Complete')
    L.push(...bullets(complete))
    L.push('')
  }

  if (wip.length || todo.length) {
    L.push('## Still open -- to be done')
    L.push(...bullets(wip, () => 'WIP'))
    L.push(...bullets(todo, () => 'todo'))
    L.push('')
  }

  L.push('## Open fixes (need attention)')
  if (openFixes.length) {
    for (const f of openFixes) {
      L.push(`- **${f.title}**`)
      if (f.problem) L.push(`  - problem: ${f.problem}`)
      if (f.solution) L.push(`  - proposed: ${f.solution}`)
      if (f.agent) L.push(`  - assigned: ${f.agent}`)
    }
  } else {
    L.push('- (no open fixes logged)')
  }
  L.push('')

  if (doneFixes.length) {
    L.push('## Recently fixed')
    for (const f of doneFixes.slice(0, 12)) {
      L.push(`- **${f.title}**${f.solution ? ` -- ${f.solution}` : ''}`)
    }
    L.push('')
  }

  if (roadmap.length) {
    L.push(`## Roadmap (${p.milestones_percent}% of milestones done)`)
    for (const m of [...roadmap].sort((a, b) => (a.order ?? 0) - (b.order ?? 0))) {
      L.push(`- ${m.done ? '[x]' : '[ ]'} ${m.title}${m.target ? ` (target: ${m.target})` : ''}`)
    }
    L.push('')
  }

  if (versions.length) {
    L.push('## Version history')
    for (const v of versions.slice(0, 8)) {
      L.push(`### v${v.version} -- ${v.date}`)
      if (v.notes) L.push(v.notes)
      for (const [label, key] of [
        ['Added', 'added'],
        ['Fixed', 'fixed'],
        ['Changed', 'changed']
      ] as const) {
        const vals = v[key] ?? []
        if (vals.length) L.push(`- ${label}: ${vals.join('; ')}`)
      }
    }
    L.push('')
  }

  if (mode === 'full' || mode === 'prompt') {
    L.push('## Ask')
    if (regressed.length) {
      L.push(
        'Start with the REGRESSION above: protected work is broken, which takes priority over everything else here.'
      )
      L.push('')
    }
    if (broken.length || openFixes.length) {
      L.push('Please help resolve the broken items and open fixes above. For each one:')
      L.push("1. Diagnose the root cause (don't guess -- inspect the code).")
      L.push('2. Propose a minimal fix and apply it.')
      L.push('3. Tell me exactly what changed and how to verify it works.')
      L.push('')
      L.push(
        'When an item is resolved, say so -- I will confirm it in PlanIDE. Marking it working ' +
          'yourself only records a claim.'
      )
    } else {
      L.push(
        'Everything tracked is currently working. Suggest the next highest-value milestone from ' +
          'the roadmap and how to approach it.'
      )
    }
    L.push('')
  }

  L.push('---')
  L.push(`_Generated by PulsarIDE ${state.version}_`)
  // Every line above is assembled from text agents wrote into the board, so the
  // briefing inherits whatever invisible marks came with it. Strip them once,
  // here, rather than trusting each writer -- this is the last point the
  // document is ours before an agent reads it back.
  return cleanText(L.join('\n')).cleaned
}
