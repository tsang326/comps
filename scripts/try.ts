// One end-to-end run against the configured Qloo client; prints a summary and cost.
import { costUSD, runComps } from '../server/agent.js'
import { makeQlooClient } from '../server/qloo.js'

const pitch = process.argv[2] ?? 'A cozy farming game where you keep a lighthouse running on a small island, befriend the fishing village and restore the coast after storms.'
const comps = (process.argv[3] ?? 'Stardew Valley, A Short Hike').split(',').map((s) => s.trim())

const t0 = Date.now()
const r = await runComps({ pitch, comps }, makeQlooClient())
const cost = costUSD(r.model, r.usage)
console.log(JSON.stringify({ seconds: Math.round((Date.now() - t0) / 1000), qloo: r.qlooMode, usage: r.usage, approxUSD: Number(cost.toFixed(3)),
  toolCalls: r.evidence.map((e) => `${e.id} ${e.tool} ${JSON.stringify(e.input)} -> ${e.entities.length + e.tags.length}`),
  report: r.report }, null, 2))
