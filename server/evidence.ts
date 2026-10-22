/*
 * Every Qloo call the agent makes is recorded here with an id (E1, E2, ...).
 * The report may only name things that appear in a cited evidence record, so
 * the model cannot invent a "Qloo signal".
 */
import type { QlooEntity, QlooTag } from './qloo.js'

export interface Evidence {
  id: string
  tool: 'qloo_search' | 'qloo_insights' | 'qloo_tags'
  input: Record<string, unknown>
  entities: QlooEntity[]
  tags: QlooTag[]
}

export class EvidenceLog {
  readonly records: Evidence[] = []

  add(tool: Evidence['tool'], input: Record<string, unknown>, entities: QlooEntity[] = [], tags: QlooTag[] = []): Evidence {
    const rec = { id: `E${this.records.length + 1}`, tool, input, entities, tags }
    this.records.push(rec)
    return rec
  }

  get(id: string) {
    return this.records.find((r) => r.id === id)
  }
}

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim()

/** True when `name` is an entity, an entity's tag, or a tag in at least one cited record. */
export function isSupported(log: EvidenceLog, name: string, cited: string[]): boolean {
  const n = norm(name)
  return cited.some((id) => {
    const r = log.get(id)
    return !!r && (r.entities.some((e) => norm(e.name) === n || e.tags?.some((t) => norm(t) === n)) || r.tags.some((t) => norm(t.name) === n))
  })
}

/** Compact text the model reads as a tool result. */
export function describe(rec: Evidence): string {
  const lines = rec.entities.map((e) =>
    `- ${e.name} [${e.entity_id}]${e.affinity !== undefined ? ` affinity=${e.affinity}` : ''}${e.popularity !== undefined ? ` popularity=${e.popularity}` : ''}${e.tags?.length ? ` tags=${e.tags.join('|')}` : ''}`)
  const tagLines = rec.tags.map((t) => `- tag ${t.name} [${t.tag_id}]${t.type ? ` ${t.type}` : ''}`)
  const body = [...lines, ...tagLines]
  return `${rec.id} (${rec.tool} ${JSON.stringify(rec.input)}):\n${body.length ? body.join('\n') : '(no results: this signal is empty for that input)'}`
}
