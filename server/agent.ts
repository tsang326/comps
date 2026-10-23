/*
 * Comps agent: research with Qloo tools, then write a launch report in which
 * every recommendation cites the evidence records it came from.
 */
import { z } from 'zod'
import { chat, strictSchema, type ChatMessage, type ChatUsage } from './openai.js'
import { ENTITY_TYPES, type QlooClient } from './qloo.js'
import { EvidenceLog, describe, isSupported, type Evidence } from './evidence.js'

// OpenAI model for reports and samples: gpt-4.1 gave the fullest, best-cited plan in our comparison
export const MODEL = process.env.COMPS_MODEL ?? 'gpt-4.1'
// USD per 1M tokens, from OpenAI's pricing page (read 2026-10-22)
export const PRICES: Record<string, { input: number; output: number }> = {
  'gpt-4.1': { input: 2, output: 8 }, 'gpt-4.1-mini': { input: 0.4, output: 1.6 }, 'gpt-4.1-nano': { input: 0.1, output: 0.4 },
  'gpt-5-mini': { input: 0.25, output: 2 }, 'gpt-5.4-mini': { input: 0.75, output: 4.5 },
}
export const costUSD = (model: string, u: { input: number; output: number }) => {
  const p = PRICES[model] ?? PRICES['gpt-4.1']
  return (u.input * p.input + u.output * p.output) / 1e6
}
// Reasoning models spend completion tokens on thinking, so they get a larger budget
const maxTokens = (model: string, base: number) => (model.startsWith('gpt-5') ? base * 4 : base)

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
- Be specific and practical: who to pitch, what to reference, why.
- Give 2-4 channels in each domain the evidence covers (podcasts, artists, TV, brands, books, movies), strongest first; never more than 4 per domain.`

const ReportSchema = z.object({
  audience_summary: z.string().describe('2-3 sentences: who this audience is, grounded in the evidence'),
  comps: z.array(z.object({ name: z.string(), why: z.string(), evidence: z.array(z.string()) })),
  channels: z.array(z.object({
    domain: z.enum(['podcast', 'artist', 'tv_show', 'brand', 'book', 'movie', 'destination', 'videogame', 'person', 'place']),
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
  /** Items whose name is in the Qloo data but which cited the wrong record; their evidence was corrected. */
  repaired: { section: string; name: string; from: string[]; to: string[] }[]
}

/**
 * Keep only items the Qloo evidence backs, by section:
 * - a channel must be an entity returned by an Insights query for that same domain;
 * - a comp must come from an Insights query seeded by entities, or be a title the
 *   creator typed (a search hit alone only proves a title exists);
 * - a positioning point may rest on any entity or tag in the evidence.
 * Citations that are not evidence ids are removed. If the name is backed but the model
 * cited the wrong record, the item is pointed at the records that do back it.
 */
export function checkReport(report: Report, log: EvidenceLog, userComps: string[] = []): CheckedReport {
  const dropped: CheckedReport['dropped'] = []
  const repaired: CheckedReport['repaired'] = []
  const typed = new Set(userComps.map(normName))
  const insights = (r: Evidence) => r.tool === 'qloo_insights'
  const allowed: Record<string, (r: Evidence, it: { name: string; domain?: string }) => boolean> = {
    channels: (r, it) => insights(r) && r.input.type === `urn:entity:${it.domain}` && r.entities.some((e) => normName(e.name) === normName(it.name)),
    comps: (r, it) => (insights(r) && Array.isArray(r.input.entity_ids) && (r.input.entity_ids as unknown[]).length > 0) || (r.tool === 'qloo_search' && typed.has(normName(it.name))),
    positioning: () => true,
  }
  const keep = <T extends { name: string; evidence: string[]; domain?: string }>(section: string, items: T[]) =>
    items.flatMap((it) => {
      const ok = (id: string) => { const r = log.get(id); return !!r && allowed[section](r, it) && isSupported(log, it.name, [id]) }
      const cited = it.evidence.filter(ok)
      if (cited.length && cited.length === it.evidence.length) return [it]
      const found = cited.length ? cited : log.records.map((r) => r.id).filter(ok)
      if (found.length) {
        repaired.push({ section, name: it.name, from: it.evidence, to: found })
        return [{ ...it, evidence: found }]
      }
      const why = section === 'channels' ? `not returned by an Insights query for ${it.domain}`
        : section === 'comps' ? 'not returned by an Insights query on your comps'
        : 'not in any Qloo result'
      dropped.push({ section, name: it.name, reason: why })
      return []
    })
  return {
    ...report,
    comps: keep('comps', report.comps),
    channels: keep('channels', report.channels),
    positioning: keep('positioning', report.positioning),
    dropped,
    repaired,
  }
}

const normName = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim()

export type Reach = 'any' | 'reachable'
export interface RunInput { pitch: string; comps: string[]; reach?: Reach }
/** Popularity cap for cross-domain results in "reachable" mode (Qloo popularity is 0-1). */
export const REACHABLE_MAX_POPULARITY = 0.7
export interface Usage { input: number; output: number; cacheRead: number; requests: number }
export interface RunResult { report: CheckedReport; evidence: EvidenceLog['records']; qlooMode: 'live' | 'mock'; notes: string; usage: Usage; model: string }

export async function runComps(input: RunInput, qloo: QlooClient, model = MODEL): Promise<RunResult> {
  const log = new EvidenceLog()
  const entityType = z.enum(ENTITY_TYPES)

  const tools: Record<string, { description: string; schema: z.ZodType; run: (args: never) => Promise<string> }> = {
    qloo_search: {
      description: 'Find Qloo entities (and their ids) by name, e.g. a game, book, artist or podcast title.',
      schema: z.object({ query: z.string(), type: entityType.optional() }),
      run: async ({ query, type }: { query: string; type?: z.infer<typeof entityType> }) =>
        describe(log.add('qloo_search', { query, type }, await qloo.search(query, type))),
    },
    qloo_insights: {
      description: 'What people who like the given entities/tags also like, within one entity type. Use entity ids from qloo_search.',
      schema: z.object({
        type: entityType,
        entity_ids: z.array(z.string()).max(5).optional(),
        tag_ids: z.array(z.string()).max(5).optional(),
        take: z.number().int().min(1).max(15).optional(),
      }),
      run: async ({ type, entity_ids, tag_ids, take }: { type: z.infer<typeof entityType>; entity_ids?: string[]; tag_ids?: string[]; take?: number }) => {
        // Reachable mode caps popularity for channels, not for the comps themselves
        const max_popularity = input.reach === 'reachable' && type !== 'urn:entity:videogame' && type !== 'urn:entity:book' ? REACHABLE_MAX_POPULARITY : undefined
        const rec = log.add('qloo_insights', { type, entity_ids, tag_ids, take, ...(max_popularity ? { max_popularity } : {}) },
          await qloo.insights({ type, entityIds: entity_ids, tagIds: tag_ids, take, maxPopularity: max_popularity }))
        const text = describe(rec)
        return rec.entities.length || !entity_ids?.length ? text
          : `${text}\nQloo has no taste signal for these ids. Use a different comp, or another search hit for the same title.`
      },
    },
    qloo_tags: {
      description: 'Find Qloo tag ids for a theme keyword such as "cozy" or "roguelike".',
      schema: z.object({ query: z.string() }),
      run: async ({ query }: { query: string }) => describe(log.add('qloo_tags', { query }, [], await qloo.tags(query))),
    },
  }
  const toolDefs = Object.entries(tools).map(([name, t]) => {
    const parameters = z.toJSONSchema(t.schema) as Record<string, unknown>
    delete parameters.$schema
    return { type: 'function' as const, function: { name, description: t.description, parameters } }
  })

  const reachNote = input.reach === 'reachable'
    ? `\nReach: the creator has a small budget. Cross-domain results are limited to less mainstream names (Qloo popularity <= ${REACHABLE_MAX_POPULARITY}) that a small team can realistically contact; favour those.`
    : ''
  const brief = `Pitch: ${input.pitch}\nComps given by the creator: ${input.comps.length ? input.comps.join('; ') : '(none)'}${reachNote}`

  const usage: Usage = { input: 0, output: 0, cacheRead: 0, requests: 0 }
  const add = (u: ChatUsage) => {
    usage.input += u.prompt_tokens; usage.output += u.completion_tokens; usage.cacheRead += u.prompt_tokens_details?.cached_tokens ?? 0; usage.requests++
  }

  // Research: tool-calling loop over the Qloo tools
  const msgs: ChatMessage[] = [{ role: 'system', content: RESEARCH_SYSTEM }, { role: 'user', content: brief }]
  let notes = ''
  for (let i = 0; i < 14; i++) {
    const { message, usage: u } = await chat({ model, messages: msgs, tools: toolDefs, max_completion_tokens: maxTokens(model, 2000) })
    add(u)
    msgs.push(message)
    if (!message.tool_calls?.length) { notes = (message.content ?? '').trim(); break }
    for (const call of message.tool_calls) {
      const tool = tools[call.function.name]
      let content: string
      if (!tool) content = `Unknown tool ${call.function.name}.`
      else {
        let raw: unknown = {}
        try { raw = JSON.parse(call.function.arguments || '{}') } catch {}
        const args = tool.schema.safeParse(raw)
        content = args.success
          ? await tool.run(args.data as never).catch((e: Error) => `Qloo call failed: ${e.message}`)
          : `Invalid arguments: ${args.error.issues.map((x) => `${x.path.join('.')} ${x.message}`).join('; ')}`
      }
      msgs.push({ role: 'tool', tool_call_id: call.id, content })
    }
  }

  // Report: strict JSON schema, then the evidence check drops anything unsupported
  const evidenceText = log.records.map(describe).join('\n\n')
  const { message, usage: u, finish } = await chat({
    model,
    messages: [
      { role: 'system', content: REPORT_SYSTEM },
      { role: 'user', content: `${brief}\n\nResearch notes:\n${notes || '(none)'}\n\nEvidence:\n${evidenceText || '(no evidence collected)'}` },
    ],
    response_format: { type: 'json_schema', json_schema: { name: 'launch_report', schema: strictSchema(ReportSchema), strict: true } },
    max_completion_tokens: maxTokens(model, 6000),
  })
  add(u)
  let parsed: Report
  try { parsed = ReportSchema.parse(JSON.parse(message.content ?? '')) } catch { throw new Error(`Report could not be parsed (finish reason: ${finish}).`) }

  return { report: checkReport(parsed, log, input.comps), evidence: log.records, qlooMode: qloo.mode, notes, usage, model }
}

/*
 * "Without Qloo" baseline: the same model, same pitch, no data. Shown next to
 * the Qloo plan so a reader can see what the taste data adds.
 */
// Same model as the report, so the comparison isolates what the Qloo data adds
export const BASELINE_MODEL = process.env.COMPS_BASELINE_MODEL ?? MODEL

const BaselineSchema = z.object({
  channels: z.array(z.object({
    domain: z.enum(['podcast', 'artist', 'tv_show', 'brand', 'book', 'movie']),
    name: z.string(),
  })).describe('Where this audience can be reached, up to 4 per domain'),
})
export interface Baseline { model: string; channels: z.infer<typeof BaselineSchema>['channels']; usage: Usage }

export async function runBaseline(input: RunInput): Promise<Baseline> {
  const { message, usage: u } = await chat({
    model: BASELINE_MODEL,
    messages: [
      { role: 'system', content: 'Without any external data, suggest where the audience for this indie game or book can be reached: podcasts, music artists, TV shows, brands, books and movies they likely enjoy. Real names only, up to 4 per domain.' },
      { role: 'user', content: `Pitch: ${input.pitch}\nComparable titles: ${input.comps.join('; ') || '(none)'}` },
    ],
    response_format: { type: 'json_schema', json_schema: { name: 'baseline', schema: strictSchema(BaselineSchema), strict: true } },
    max_completion_tokens: maxTokens(BASELINE_MODEL, 1500),
  })
  const parsed = BaselineSchema.parse(JSON.parse(message.content ?? '{}'))
  return { model: BASELINE_MODEL, channels: parsed.channels, usage: { input: u.prompt_tokens, output: u.completion_tokens, cacheRead: u.prompt_tokens_details?.cached_tokens ?? 0, requests: 1 } }
}
