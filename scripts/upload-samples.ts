/* Copy local cache/samples.json into Upstash Redis (KV_REST_API_URL/TOKEN must be set). */
import { readFile } from 'node:fs/promises'
import { redis, saveSamples, loadSamples, type Sample } from '../server/samples.js'

if (!redis()) throw new Error('KV_REST_API_URL / KV_REST_API_TOKEN are not set')
const local = JSON.parse(await readFile(new URL('../cache/samples.json', import.meta.url), 'utf8')) as Sample[]
await saveSamples(local)
const stored = await loadSamples()
console.log(`stored ${stored.length} samples:`, stored.map((s) => s.slug).join(', '))
