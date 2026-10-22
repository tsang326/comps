/*
 * Qloo API client. Hackathon keys only work against hackathon.api.qloo.com,
 * sent as the X-Api-Key header. The key stays on the server.
 *
 * Response field names follow the docs read on 2026-10-21 (results.entities,
 * query.affinity) and what the hackathon API returned on 2026-10-22: /search
 * gives a flat results array with a types array, and the game type is
 * urn:entity:videogame (no underscore).
 */

export const ENTITY_TYPES = [
  'urn:entity:artist',
  'urn:entity:book',
  'urn:entity:brand',
  'urn:entity:destination',
  'urn:entity:movie',
  'urn:entity:person',
  'urn:entity:place',
  'urn:entity:podcast',
  'urn:entity:tv_show',
  'urn:entity:videogame',
] as const
export type EntityType = (typeof ENTITY_TYPES)[number]

export interface QlooEntity {
  entity_id: string
  name: string
  type?: string
  popularity?: number
  affinity?: number
  tags?: string[]
}

export interface QlooTag {
  tag_id: string
  name: string
  type?: string
}

export interface InsightsQuery {
  type: EntityType
  entityIds?: string[]
  tagIds?: string[]
  take?: number
  /** Only results at or below this popularity (0-1): smaller names a small team can reach. */
  maxPopularity?: number
}

export interface QlooClient {
  readonly mode: 'live' | 'mock'
  search(query: string, type?: EntityType): Promise<QlooEntity[]>
  insights(q: InsightsQuery): Promise<QlooEntity[]>
  tags(query: string): Promise<QlooTag[]>
}

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined)

export function parseEntities(json: unknown): QlooEntity[] {
  const j = json as { results?: { entities?: unknown[] } | unknown[] } | null
  const list = Array.isArray(j?.results) ? j.results : (j?.results as { entities?: unknown[] } | undefined)?.entities ?? []
  return list.flatMap((raw) => {
    const e = raw as Record<string, unknown>
    const id = e.entity_id ?? e.id
    if (typeof id !== 'string' || typeof e.name !== 'string') return []
    const query = (e.query ?? {}) as Record<string, unknown>
    // Keep the tags that describe taste (tone, audience, genre, gameplay), not platforms
    const tags = Array.isArray(e.tags)
      ? [...new Set(e.tags
          .filter((t) => !/:(platform|player_mode):/.test(String((t as { type?: unknown }).type ?? '')))
          .map((t) => (t as { name?: unknown }).name)
          .filter((n): n is string => typeof n === 'string'))].slice(0, 10)
      : undefined
    return [{
      entity_id: id,
      name: e.name,
      type: typeof e.type === 'string' ? e.type : Array.isArray(e.types) && typeof e.types[0] === 'string' ? e.types[0] : undefined,
      popularity: num(e.popularity),
      affinity: num(query.affinity),
      tags,
    }]
  })
}

export class HttpQlooClient implements QlooClient {
  readonly mode = 'live' as const
  constructor(private apiKey: string, private baseUrl = 'https://hackathon.api.qloo.com') {}

  private async get(path: string, params: Record<string, string>): Promise<unknown> {
    const url = `${this.baseUrl}${path}?${new URLSearchParams(params)}`
    const res = await fetch(url, { headers: { 'X-Api-Key': this.apiKey }, signal: AbortSignal.timeout(15_000) })
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      // Some titles are searchable but carry no taste signal: Qloo answers 400 "were invalid"
      if (res.status === 400 && /were invalid/.test(body)) return { results: { entities: [] } }
      throw new Error(`Qloo ${path} returned HTTP ${res.status}`)
    }
    return res.json()
  }

  async search(query: string, type?: EntityType) {
    return parseEntities(await this.get('/search', { query, ...(type ? { types: type } : {}) }))
  }

  async insights(q: InsightsQuery) {
    const params: Record<string, string> = { 'filter.type': q.type, take: String(q.take ?? 10) }
    if (q.entityIds?.length) params['signal.interests.entities'] = q.entityIds.join(',')
    if (q.tagIds?.length) params['signal.interests.tags'] = q.tagIds.join(',')
    if (q.maxPopularity !== undefined) params['filter.popularity.max'] = String(q.maxPopularity)
    return parseEntities(await this.get('/v2/insights', params))
  }

  async tags(query: string) {
    // TODO(key day): confirm the query parameter name for /v2/tags
    const json = (await this.get('/v2/tags', { 'filter.query': query })) as { results?: { tags?: unknown[] } }
    return (json.results?.tags ?? []).flatMap((raw) => {
      const t = raw as Record<string, unknown>
      const id = t.tag_id ?? t.id
      return typeof id === 'string' && typeof t.name === 'string'
        ? [{ tag_id: id, name: t.name, type: typeof t.type === 'string' ? t.type : undefined }]
        : []
    })
  }
}

/*
 * Synthetic data for building and testing without a key. Every name is made
 * up and marked "(mock)": the rules forbid committing real Qloo responses.
 */
export class MockQlooClient implements QlooClient {
  readonly mode = 'mock' as const

  private id(prefix: string, s: string) {
    let h = 0
    for (const c of s.toLowerCase()) h = (h * 31 + c.charCodeAt(0)) >>> 0
    return `${prefix}-${h.toString(16)}`
  }

  async search(query: string, type: EntityType = 'urn:entity:videogame') {
    return [{ entity_id: this.id('mock', query), name: `${query} (mock)`, type, popularity: 0.5 }]
  }

  async insights(q: InsightsQuery) {
    const kind = q.type.split(':').pop()!.replace('_', ' ')
    const seed = [...(q.entityIds ?? []), ...(q.tagIds ?? [])].join(',') || 'none'
    return Array.from({ length: Math.min(q.take ?? 5, 5) }, (_, i) => ({
      entity_id: this.id('mock', `${q.type}:${seed}:${i}`),
      name: `Sample ${kind} ${i + 1} (mock)`,
      type: q.type,
      affinity: Math.round((0.95 - i * 0.07) * 100) / 100,
      popularity: Math.round((0.3 + i * 0.1) * 100) / 100,
      tags: ['cozy (mock)', 'indie (mock)'],
    }))
  }

  async tags(query: string) {
    return [{ tag_id: this.id('tag', query), name: `${query} (mock)`, type: 'urn:tag:keyword' }]
  }
}

export function makeQlooClient(env = process.env): QlooClient {
  if (env.QLOO_MODE === 'mock' || !env.QLOO_API_KEY) return new MockQlooClient()
  return new HttpQlooClient(env.QLOO_API_KEY, env.QLOO_BASE_URL || undefined)
}
