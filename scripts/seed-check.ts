// Is a cross-domain result specific to the seed, or just popular everywhere? Runs the same
// podcast Insights query seeded by different games and prints the top results (Qloo only,
// no model calls). Output contains Qloo data: print it, don't commit it.
//   node --env-file=.env --import tsx scripts/seed-check.ts
import { makeQlooClient } from '../server/qloo.js'

const qloo = makeQlooClient()
const seeds = [['Stardew Valley', 'A Short Hike'], ['The Sims 4'], ['DOOM Eternal'], ['Call of Duty: Black Ops 6']]
for (const titles of seeds) {
  const ids: string[] = []
  for (const t of titles) {
    const hits = await qloo.search(t, 'urn:entity:videogame')
    const hit = hits.find((e) => e.name.toLowerCase() === t.toLowerCase()) ?? hits[0]
    if (hit) ids.push(hit.entity_id)
  }
  const top = await qloo.insights({ type: 'urn:entity:podcast', entityIds: ids, take: 5 })
  console.log(`${titles.join(' + ')}: ${top.map((e) => `${e.name} (${e.affinity?.toFixed(2)})`).join(', ')}`)
}
