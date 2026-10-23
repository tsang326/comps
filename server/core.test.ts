import { describe, expect, it } from 'vitest'
import { EvidenceLog, isSupported } from './evidence.js'
import { checkReport, type Report } from './agent.js'
import { parseEntities, MockQlooClient } from './qloo.js'
import { parseInput, phase } from './handler.js'

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
  it('checks channels against the domain queried and comps against the creator\'s titles', () => {
    const l = new EvidenceLog()
    l.add('qloo_search', { query: 'Stardew Valley', type: 'urn:entity:videogame' }, [{ entity_id: 'g1', name: 'Stardew Valley' }, { entity_id: 'g2', name: 'Monument Valley' }])
    l.add('qloo_insights', { type: 'urn:entity:podcast', entity_ids: ['g1'] }, [{ entity_id: 'p1', name: 'Night Vale' }])
    l.add('qloo_insights', { type: 'urn:entity:videogame', tag_ids: ['cozy'] }, [{ entity_id: 'g3', name: 'Tag Only Game' }])
    l.add('qloo_insights', { type: 'urn:entity:videogame', entity_ids: ['g1'] }, [{ entity_id: 'g4', name: 'A Short Hike' }])
    const report: Report = {
      audience_summary: 's', interpretation: '', limits: [], positioning: [],
      comps: [
        { name: 'Stardew Valley', why: '', evidence: ['E1'] },
        { name: 'Monument Valley', why: '', evidence: ['E1'] },
        { name: 'Tag Only Game', why: '', evidence: ['E3'] },
        { name: 'A Short Hike', why: '', evidence: ['E4', 'D87A3DA3-UUID'] },
      ],
      channels: [
        { domain: 'podcast', name: 'Night Vale', action: '', evidence: ['E2'] },
        { domain: 'brand', name: 'Night Vale', action: '', evidence: ['E2'] },
      ],
    }
    const out = checkReport(report, l, ['stardew valley'])
    expect(out.comps.map((c) => c.name)).toEqual(['Stardew Valley', 'A Short Hike'])
    expect(out.comps[1].evidence).toEqual(['E4'])
    expect(out.repaired).toEqual([])
    expect(out.channels).toHaveLength(1)
    expect(out.dropped.map((d) => d.name)).toEqual(['Monument Valley', 'Tag Only Game', 'Night Vale'])
  })
})

describe('phase', () => {
  it('raises the allowance during judging (2-16 Nov, VN time)', () => {
    expect(phase(Date.parse('2026-10-25T00:00:00Z')).name).toBe('pre')
    expect(phase(Date.parse('2026-11-05T00:00:00Z')).name).toBe('judging')
    expect(phase(Date.parse('2026-11-20T00:00:00Z')).name).toBe('pre')
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
