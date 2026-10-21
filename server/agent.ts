/*
 * Comps agent: research with Qloo tools, then write a launch report in which
 * every recommendation cites the evidence records it came from.
 */
import Anthropic from '@anthropic-ai/sdk'
import { betaZodTool, betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod'
import { z } from 'zod'
import { ENTITY_TYPES, type QlooClient } from './qloo.js'
import { EvidenceLog, describe, isSupported } from './evidence.js'

export const MODEL = 'claude-opus-5-5'

// Refusals on this model route to a fallback model server-side
const FALLBACK = { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const }

const RESEARCH_SYSTEM = `You research the audience for an indie game or self-published book, using Qloo's taste data.

Work like this:
1. Resolve the comparable titles ("comps") the creator gave you with qloo_search. If they gave none, pick 2-3 well-known titles that genuinely match the pitch and resolve those. Prefer specific titles over genres.
2. Use qloo_insights with the resolved comp entity ids to see what the same audience likes in OTHER domains: podcasts, artists, TV shows, brands, books, movies. That cross-domain view is the point of this tool.
3. Use qloo_tags when a theme from the pitch (e.g. "cozy", "roguelike") is worth adding as a signal.

Rules: every tool result has an evidence id (E1, E2, ...). Do not invent entities. If a query returns nothing, say so and try a different comp or domain instead of guessing. Stop after enough evidence for a useful plan (usually 6-10 tool calls). Finish with a short plain-text summary of what you found and which evidence ids matter most.`

const REPORT_SYSTEM = `You turn Qloo research into a launch plan for an indie creator.

Hard rules:
- Every recommended channel, comp and positioning point must cite evidence ids, and its "name" must be copied exactly from an entity or tag in one of those records.
- Qloo describes what groups of people tend to like, not what one person will do. Never state an affinity as a fact about an individual or a guarantee.
- Anything that is your own interpretation rather than Qloo data goes in "interpretation", clearly labelled.
- Be specific and practical: who to pitch, what to reference, why.`

const ReportSchema = z.object({
  audience_summary: z.string().describe('2-3 sentences: who this audience is, grounded in the evidence'),
  comps: z.array(z.object({ name: z.string(), why: z.string(), evidence: z.array(z.string()) })),
  channels: z.array(z.object({
    domain: z.enum(['podcast', 'artist', 'tv_show', 'brand', 'book', 'movie', 'destination', 'video_game', 'person', 'place']),
    name: z.string(),
    action: z.string().describe('What the creator should do with this, e.g. pitch, reference in ads'),
    evidence: z.array(z.string()),
  })),
  positioning: z.array(z.object({ point: z.string(), name: z.string().describe('Entity or tag this rests on'), evidence: z.array(z.string()) })),
  interpretation: z.string().describe('Your own suggestions that are not Qloo data (taglines etc.), labelled as interpretation'),
  limits: z.array(z.string()).describe('What these results do not establish'),
})
export type Report = z.infer<typeof ReportSchema>

export interface CheckedReport extends Report {
  dropped: { section: string; name: string; reason: string }[]
}

/** Drop any item whose name is not found in the evidence it cites. */
export function checkReport(report: Report, log: EvidenceLog): CheckedReport {
  const dropped: CheckedReport['dropped'] = []
  const keep = <T extends { name: string; evidence: string[] }>(section: string, items: T[]) =>
    items.filter((it) => {
      const ok = isSupported(log, it.name, it.evidence)
      if (!ok) dropped.push({ section, name: it.name, reason: it.evidence.length ? `not found in ${it.evidence.join(', ')}` : 'no evidence cited' })
      return ok
    })
  return {
    ...report,
    comps: keep('comps', report.comps),
    channels: keep('channels', report.channels),
    positioning: keep('positioning', report.positioning),
    dropped,
  }
}

export interface RunInput { pitch: string; comps: string[] }
export interface Usage { input: number; output: number; cacheRead: number; requests: number }
export interface RunResult { report: CheckedReport; evidence: EvidenceLog['records']; qlooMode: 'live' | 'mock'; notes: string; usage: Usage }

export async function runComps(input: RunInput, qloo: QlooClient, client = new Anthropic()): Promise<RunResult> {
  const log = new EvidenceLog()
  const entityType = z.enum(ENTITY_TYPES)

  const tools = [
    betaZodTool({
      name: 'qloo_search',
      description: 'Find Qloo entities (and their ids) by name, e.g. a game, book, artist or podcast title.',
      inputSchema: z.object({ query: z.string(), type: entityType.optional() }),
      run: async ({ query, type }) => describe(log.add('qloo_search', { query, type }, await qloo.search(query, type))),
    }),
    betaZodTool({
      name: 'qloo_insights',
      description: 'What people who like the given entities/tags also like, within one entity type. Use entity ids from qloo_search.',
      inputSchema: z.object({
        type: entityType,
        entity_ids: z.array(z.string()).max(5).optional(),
        tag_ids: z.array(z.string()).max(5).optional(),
        take: z.number().int().min(1).max(15).optional(),
      }),
      run: async ({ type, entity_ids, tag_ids, take }) =>
        describe(log.add('qloo_insights', { type, entity_ids, tag_ids, take },
          await qloo.insights({ type, entityIds: entity_ids, tagIds: tag_ids, take }))),
    }),
    betaZodTool({
      name: 'qloo_tags',
      description: 'Find Qloo tag ids for a theme keyword such as "cozy" or "roguelike".',
      inputSchema: z.object({ query: z.string() }),
      run: async ({ query }) => describe(log.add('qloo_tags', { query }, [], await qloo.tags(query))),
    }),
  ]

  const brief = `Pitch: ${input.pitch}\nComps given by the creator: ${input.comps.length ? input.comps.join('; ') : '(none)'}`

  const usage: Usage = { input: 0, output: 0, cacheRead: 0, requests: 0 }
  const add = (u: { input_tokens: number; output_tokens: number; cache_read_input_tokens?: number | null }) => {
    usage.input += u.input_tokens; usage.output += u.output_tokens; usage.cacheRead += u.cache_read_input_tokens ?? 0; usage.requests++
  }

  const runner = client.beta.messages.toolRunner({
    model: MODEL,
    max_tokens: 16000,
    max_iterations: 14,
    output_config: { effort: 'medium' },
    system: RESEARCH_SYSTEM,
    tools,
    messages: [{ role: 'user', content: brief }],
    ...FALLBACK,
  })
  for await (const message of runner) add(message.usage)
  const research = await runner.done()
  const notes = research.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('\n').trim()

  const evidenceText = log.records.map(describe).join('\n\n')
  const parsed = await client.beta.messages.parse({
    model: MODEL,
    max_tokens: 16000,
    output_config: { effort: 'medium', format: betaZodOutputFormat(ReportSchema) },
    system: REPORT_SYSTEM,
    messages: [{ role: 'user', content: `${brief}\n\nResearch notes:\n${notes || '(none)'}\n\nEvidence:\n${evidenceText || '(no evidence collected)'}` }],
    ...FALLBACK,
  })
  add(parsed.usage)
  if (parsed.stop_reason === 'refusal') throw new Error('The model declined to write this report.')
  if (!parsed.parsed_output) throw new Error(`Report could not be parsed (stop reason: ${parsed.stop_reason}).`)

  return { report: checkReport(parsed.parsed_output, log), evidence: log.records, qlooMode: qloo.mode, notes, usage }
}
