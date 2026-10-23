/* Re-run checkReport on stored samples after the rules change (no model calls). Prints what changed; `--write` saves. */
import { checkReport } from '../server/agent.js'
import { EvidenceLog } from '../server/evidence.js'
import { loadSamples, saveSamples } from '../server/samples.js'

const samples = await loadSamples()
for (const s of samples) {
  const log = new EvidenceLog()
  for (const e of s.result.evidence) log.add(e.tool, e.input, e.entities, e.tags)
  const prev = s.result.report
  const next = checkReport(prev, log, s.input.comps)
  console.log(`${s.slug}: dropped now ${next.dropped.map((d) => `${d.section}:${d.name}`).join('; ') || '-'}; repaired ${next.repaired.length}`)
  s.result.report = { ...next, dropped: [...prev.dropped, ...next.dropped], repaired: [...prev.repaired, ...next.repaired] }
}
if (process.argv.includes('--write')) { await saveSamples(samples); console.log('saved') }
