// Run one report and store it as a landing-page sample (outside git).
//   node --env-file=.env --import tsx scripts/make-sample.ts <slug> "<title>" "<pitch>" "<comp1, comp2>" [reachable]
import { runBaseline, runComps } from '../server/agent.js'
import { makeQlooClient } from '../server/qloo.js'
import { loadSamples, saveSamples } from '../server/samples.js'

const [slug, title, pitch, comps = '', reach] = process.argv.slice(2)
if (!slug || !title || !pitch) { console.error('usage: make-sample <slug> <title> <pitch> [comps]'); process.exit(2) }
const qloo = makeQlooClient()
if (qloo.mode !== 'live') { console.error('Refusing to store a sample made from mock data.'); process.exit(1) }

const input = { pitch, comps: comps.split(',').map((s) => s.trim()).filter(Boolean), reach: reach === 'reachable' ? 'reachable' as const : 'any' as const }
const [result, baseline] = await Promise.all([runComps(input, qloo), runBaseline(input)])
const samples = (await loadSamples()).filter((s) => s.slug !== slug)
samples.push({ slug, title, input, result, baseline, createdAt: new Date().toISOString() })
await saveSamples(samples)
console.log(`stored ${slug}: ${result.report.channels.length} channels, ${result.report.dropped.length} dropped, usage ${JSON.stringify(result.usage)}`)
