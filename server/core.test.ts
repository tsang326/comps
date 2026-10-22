import { describe, expect, it } from 'vitest'
import { EvidenceLog, isSupported } from './evidence.js'
import { checkReport, type Report } from './agent.js'
import { parseEntities, MockQlooClient } from './qloo.js'
import { parseInput } from './handler.js'

const log = new EvidenceLog()
log.add('qloo_insights', { type: 'urn:entity:podcast' }, [{ entity_id: 'p1', name: 'Cozy Corner Podcast' }])
log.add('qloo_tags', { query: 'cozy' }, [], [{ tag_id: 't1', name: 'Cozy' }])

describe('isSupported', () => {
  it('matches names in cited records only', () => {
    expect(isSupported(log, 'cozy corner podcast', ['E1'])).toBe(true)
    expect(isSupported(log, 'Cozy Corner Podcast', ['E2'])).toBe(false)
    expect(isSupported(log, 'Cozy', ['E2'])).toBe(true)
    expect(isSupported(log, 'Cozy Corner Podcast', ['E9'])).toBe(false)
  })

  it('accepts a tag carried by an entity in a cited record', () => {
    const l = new EvidenceLog()
    l.add('qloo_insights', { type: 'urn:entity:videogame' }, [{ entity_id: 'g1', name: 'Some Game', tags: ['stress-free', 'Exploration'] }])
    expect(isSupported(l, 'Stress-free', ['E1'])).toBe(true)
    expect(isSupported(l, 'therapeutic', ['E1'])).toBe(false)
  })
})

describe('checkReport', () => {
  it('drops items the evidence does not back', () => {
    const report: Report = {
      audience_summary: 's',
      comps: [],
      channels: [
        { domain: 'podcast', name: 'Cozy Corner Podcast', action: 'pitch', evidence: ['E1'] },
        { domain: 'podcast', name: 'Invented Show', action: 'pitch', evidence: ['E1'] },
        { domain: 'brand', name: 'No Cite', action: 'x', evidence: [] },
      ],
      positioning: [{ point: 'lean into cozy', name: 'Cozy', evidence: ['E2'] }],
      interpretation: '',
      limits: [],
    }
    const out = checkReport(report, log)
    expect(out.channels.map((c) => c.name)).toEqual(['Cozy Corner Podcast'])
    expect(out.positioning).toHaveLength(1)
    expect(out.dropped.map((d) => d.name)).toEqual(['Invented Show', 'No Cite'])
  })

  it('points an item at the right record when the name is in the data but miscited', () => {
    const report: Report = {
      audience_summary: 's', comps: [], interpretation: '', limits: [],
      channels: [{ domain: 'podcast', name: 'Cozy Corner Podcast', action: 'pitch', evidence: ['E2'] }],
      positioning: [],
    }
    const out = checkReport(report, log)
    expect(out.channels[0].evidence).toEqual(['E1'])
    expect(out.repaired).toEqual([{ section: 'channels', name: 'Cozy Corner Podcast', from: ['E2'], to: ['E1'] }])
    expect(out.dropped).toEqual([])
  })
})

describe('parseEntities', () => {
  it('reads results.entities and query.affinity, skipping malformed rows', () => {
    const out = parseEntities({ results: { entities: [
      { entity_id: 'a', name: 'A', type: 'urn:entity:artist', popularity: 0.8, query: { affinity: 0.9 }, tags: [{ name: 'x' }] },
      { name: 'no id' },
    ] } })
    expect(out).toEqual([{ entity_id: 'a', name: 'A', type: 'urn:entity:artist', popularity: 0.8, affinity: 0.9, tags: ['x'] }])
  })
})

describe('MockQlooClient', () => {
  it('is deterministic and labels everything as mock', async () => {
    const m = new MockQlooClient()
    const a = await m.insights({ type: 'urn:entity:podcast', entityIds: ['x'] })
    const b = await m.insights({ type: 'urn:entity:podcast', entityIds: ['x'] })
    expect(a).toEqual(b)
    expect(a.every((e) => e.name.endsWith('(mock)'))).toBe(true)
  })
})

describe('parseInput', () => {
  it('reads the small-budget reach option', () => {
    expect(parseInput({ pitch: 'A cozy farming game about a lighthouse keeper.', reach: 'reachable' })).toMatchObject({ reach: 'reachable' })
    expect(parseInput({ pitch: 'A cozy farming game about a lighthouse keeper.', reach: 'anything else' })).toMatchObject({ reach: 'any' })
  })

  it('validates pitch and trims comps', () => {
    expect(parseInput({ pitch: 'short' })).toMatch(/at least/)
    expect(parseInput({ pitch: 'A cozy farming game about a lighthouse keeper.', comps: [' Stardew Valley ', '', 3] }))
      .toEqual({ pitch: 'A cozy farming game about a lighthouse keeper.', comps: ['Stardew Valley'], reach: 'any' })
  })
})
