// Same pitch on several models: cost, time, and how much of the report survives the evidence check.
import { costUSD, runComps } from '../server/agent.js'
import { makeQlooClient } from '../server/qloo.js'

const models = (process.argv[2] ?? 'gpt-4.1-mini,gpt-4.1,gpt-5-mini').split(',')
const input = { pitch: 'A cozy farming game where you keep a lighthouse running on a small island, befriend the fishing village and restore the coast after storms.', comps: ['Stardew Valley', 'A Short Hike'] }
for (const m of models) {
  const t0 = Date.now()
  try {
    const r = await runComps(input, makeQlooClient(), m)
    const rep = r.report
    console.log(`\n=== ${m}: ${Math.round((Date.now() - t0) / 1000)}s $${costUSD(m, r.usage).toFixed(3)} qloo calls=${r.evidence.length} channels=${rep.channels.length} comps=${rep.comps.length} positioning=${rep.positioning.length} dropped=${rep.dropped.length} repaired=${rep.repaired.length}`)
    console.log('summary:', rep.audience_summary)
    console.log('channels:', rep.channels.map((c) => `${c.domain}:${c.name}`).join(' | '))
    console.log('positioning:', rep.positioning.map((p) => p.name).join(' | '))
  } catch (e) { console.log(`=== ${m}: FAILED ${(e as Error).message}`) }
}
