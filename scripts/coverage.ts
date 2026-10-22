// Coverage check (key day): does Qloo know real indie games, and does it return
// cross-domain affinities for them? Prints counts and the top name per domain only.
import { makeQlooClient, type EntityType } from '../server/qloo.js'

const titles = (process.argv[2] ?? 'Stardew Valley,A Short Hike,Hades,Celeste,Hollow Knight,Spiritfarer,Unpacking,Dredge,Cult of the Lamb,Slay the Spire,Dave the Diver,Vampire Survivors').split(',')
const domains: EntityType[] = ['urn:entity:podcast', 'urn:entity:artist', 'urn:entity:tv_show', 'urn:entity:brand', 'urn:entity:book', 'urn:entity:movie']
const q = makeQlooClient()
console.log('mode', q.mode)
for (const t of titles) {
  try {
    const hits = await q.search(t.trim(), 'urn:entity:videogame')
    const top = hits[0]
    if (!top) { console.log(`${t}: NOT FOUND`); continue }
    const row: string[] = []
    for (const d of domains) {
      try {
        const r = await q.insights({ type: d, entityIds: [top.entity_id], take: 5 })
        row.push(`${d.split(':').pop()}=${r.length}${r[0] ? ` (${r[0].name.slice(0, 24)})` : ''}`)
      } catch (e) { row.push(`${d.split(':').pop()}=ERR ${(e as Error).message.slice(-8)}`) }
    }
    console.log(`${t} -> "${top.name}" pop=${top.popularity ?? '?'} | ${row.join(' | ')}`)
  } catch (e) { console.log(`${t}: ERR ${(e as Error).message}`) }
}
