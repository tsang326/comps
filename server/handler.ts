/*
 * POST /api/report { pitch, comps[] } -> report + evidence.
 * Shared by the local dev server and the Vercel function.
 * Keys stay server-side; results are cached by input and requests are rate
 * limited so the public demo survives the judging period.
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import { createHash } from 'node:crypto'
import { MODEL, costUSD, runBaseline, runComps, type Baseline, type Reach, type RunResult } from './agent.js'
import { makeQlooClient } from './qloo.js'
import { loadSamples, redis } from './samples.js'

const MAX_PITCH = 600
const MAX_COMPS = 4
const PER_IP_PER_HOUR = 5
// Per device (an id the browser keeps in localStorage) as well as per IP: a shared
// office IP is not punished for one heavy user, and one device can't rotate IPs.
const PER_DEVICE_PER_HOUR = 3
const PER_DEVICE_PER_DAY = 8
// Model for new public runs (OpenAI)
const PUBLIC_MODEL = process.env.COMPS_PUBLIC_MODEL ?? MODEL

// Judging runs 2-16 Nov 2026. Before it the demo gets a small allowance; during it, more.
// Each phase also has a spend budget, so a burst of traffic cannot drain the credit.
const JUDGING_FROM = Date.parse('2026-11-01T17:00:00Z') // 2 Nov 00:00 VN
const JUDGING_TO = Date.parse('2026-11-17T17:00:00Z')
export function phase(now = Date.now()) {
  const judging = now >= JUDGING_FROM && now < JUDGING_TO
  return judging
    ? { name: 'judging', reportsPerDay: 8, baselinesPerDay: 20, budgetUSD: 0.7 }
    : { name: 'pre', reportsPerDay: 3, baselinesPerDay: 6, budgetUSD: 0.3 }
}
const PAUSED = 'Live runs are paused for today to keep this free demo within its budget. The sample plans above are complete runs you can open.'

const memory = new Map<string, unknown>()
const hits = new Map<string, number[]>()

/** Results cached by input: Redis when deployed (kept through judging), memory locally. */
async function getCached<T>(key: string): Promise<T | undefined> {
  const r = redis()
  return r ? ((await r.get<T>(`comps:cache:${key}`)) ?? undefined) : (memory.get(key) as T | undefined)
}
async function setCached(key: string, value: unknown) {
  const r = redis()
  if (r) await r.set(`comps:cache:${key}`, value, { ex: 40 * 86_400 })
  else memory.set(key, value)
}

/** Counts one use of `key` in a window; Redis when deployed (shared by all instances), memory locally. */
async function countUse(key: string, windowSeconds: number): Promise<number> {
  const r = redis()
  if (r) {
    const n = await r.incr(`comps:use:${key}`)
    if (n === 1) await r.expire(`comps:use:${key}`, windowSeconds)
    return n
  }
  const now = Date.now()
  const recent = (hits.get(key) ?? []).filter((t) => now - t < windowSeconds * 1000)
  hits.set(key, [...recent, now])
  return recent.length + 1
}

const overDailyCap = async (bucket: 'report' | 'baseline') => {
  const p = phase()
  return (await countUse(`${bucket}:day:${new Date().toISOString().slice(0, 10)}`, 2 * 86_400)) > (bucket === 'report' ? p.reportsPerDay : p.baselinesPerDay)
}

/** Dollars spent on model calls in the current phase (Redis when deployed, memory locally). */
async function spent(): Promise<number> {
  const r = redis(), k = `spent:${phase().name}`
  return r ? Number((await r.get(`comps:${k}`)) ?? 0) : Number(memory.get(k) ?? 0)
}
async function addSpend(usd: number) {
  const r = redis(), k = `spent:${phase().name}`
  if (r) await r.incrbyfloat(`comps:${k}`, usd)
  else memory.set(k, Number(memory.get(k) ?? 0) + usd)
}
const overBudget = async () => (await spent()) >= phase().budgetUSD

/** A sample whose input matches this request: served as-is, no model call. */
async function sampleFor(key: string, keyOf: (i: { pitch: string; comps: string[]; reach: Reach }) => string) {
  for (const s of await loadSamples()) {
    const i = parseInput(s.input)
    if (typeof i !== 'string' && keyOf(i) === key) return s
  }
  return undefined
}
const rateLimited = async (ip: string, bucket = 'report') => (await countUse(`${bucket}:${ip}:${new Date().toISOString().slice(0, 13)}`, 3600)) > PER_IP_PER_HOUR

/** The browser's device id (x-device-id), or '' when missing or malformed. */
const deviceId = (req: IncomingMessage) => {
  const d = String(req.headers['x-device-id'] ?? '')
  return /^[a-z0-9-]{8,64}$/i.test(d) ? d : ''
}
/** Over a device limit; a request with no device id is treated as one shared "unknown" device. */
async function deviceLimited(req: IncomingMessage, bucket = 'report') {
  const d = deviceId(req) || 'unknown'
  const now = new Date().toISOString()
  return (await countUse(`${bucket}:dev:${d}:${now.slice(0, 13)}`, 3600)) > PER_DEVICE_PER_HOUR
    || (await countUse(`${bucket}:devday:${d}:${now.slice(0, 10)}`, 2 * 86_400)) > PER_DEVICE_PER_DAY
}

function send(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(body))
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  let raw = ''
  for await (const chunk of req) {
    raw += chunk
    if (raw.length > 10_000) throw new Error('Request too large')
  }
  return JSON.parse(raw || '{}')
}

export function parseInput(body: unknown): { pitch: string; comps: string[]; reach: Reach } | string {
  const b = body as { pitch?: unknown; comps?: unknown; reach?: unknown }
  const pitch = typeof b.pitch === 'string' ? b.pitch.trim() : ''
  if (pitch.length < 20) return 'Describe your game or book in at least a sentence.'
  if (pitch.length > MAX_PITCH) return `Keep the pitch under ${MAX_PITCH} characters.`
  const comps = Array.isArray(b.comps)
    ? b.comps.filter((c): c is string => typeof c === 'string').map((c) => c.trim()).filter(Boolean).slice(0, MAX_COMPS)
    : []
  if (comps.some((c) => c.length > 80)) return 'Each comparable title should be under 80 characters.'
  return { pitch, comps, reach: b.reach === 'reachable' ? 'reachable' : 'any' }
}

const clientIp = (req: IncomingMessage) => String(req.headers['x-forwarded-for'] ?? req.socket.remoteAddress ?? 'unknown').split(',')[0].trim()

/** POST /api/baseline { pitch, comps[] } -> what the model suggests without Qloo. */
export async function handleBaseline(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
  if (req.method !== 'POST' || !req.url?.startsWith('/api/baseline')) return false
  let body: unknown
  try { body = await readJson(req) } catch { send(res, 400, { error: 'Invalid JSON body.' }); return true }
  const input = parseInput(body)
  if (typeof input === 'string') { send(res, 422, { error: input }); return true }
  const keyOf = (i: { pitch: string; comps: string[] }) => createHash('sha256').update(JSON.stringify({ pitch: i.pitch, comps: i.comps }).toLowerCase()).digest('hex')
  const key = keyOf(input)
  const cached = await getCached<Baseline>(`baseline:${key}`) ?? (await sampleFor(key, keyOf))?.baseline
  if (cached) { send(res, 200, cached); return true }
  if (await deviceLimited(req, 'baseline') || await rateLimited(clientIp(req), 'baseline')) { send(res, 429, { error: 'Too many comparisons from this address; try again in an hour.' }); return true }
  if (await overBudget() || await overDailyCap('baseline')) { send(res, 429, { error: PAUSED }); return true }
  try {
    const b = await runBaseline(input)
    await addSpend(costUSD(b.model, b.usage))
    await setCached(`baseline:${key}`, b)
    send(res, 200, b)
  } catch (err) {
    console.error('baseline failed:', err instanceof Error ? err.message : String(err))
    send(res, 502, { error: 'The comparison failed. Please try again in a minute.' })
  }
  return true
}

export async function handleSamples(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
  if (req.method !== 'GET' || !req.url?.startsWith('/api/samples')) return false
  try {
    const samples = await loadSamples()
    send(res, 200, samples.map(({ slug, title, input, result, baseline }) => ({ slug, title, input, result, baseline })))
  } catch {
    send(res, 200, [])
  }
  return true
}

export async function handleReport(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
  if (req.method !== 'POST' || !req.url?.startsWith('/api/report')) return false
  let body: unknown
  try { body = await readJson(req) } catch { send(res, 400, { error: 'Invalid JSON body.' }); return true }

  const input = parseInput(body)
  if (typeof input === 'string') { send(res, 422, { error: input }); return true }

  const keyOf = (i: object) => createHash('sha256').update(JSON.stringify(i).toLowerCase()).digest('hex')
  const key = keyOf(input)
  const cached = await getCached<RunResult>(`report:${key}`) ?? (await sampleFor(key, keyOf))?.result
  if (cached) { send(res, 200, { ...cached, cached: true }); return true }

  // Per device and IP first, so one client hitting its own limit does not use up the day for everyone
  if (await deviceLimited(req) || await rateLimited(clientIp(req))) { send(res, 429, { error: 'Too many new reports from this address; try again in an hour or open a sample report.' }); return true }
  if (await overBudget() || await overDailyCap('report')) { send(res, 429, { error: PAUSED }); return true }

  try {
    const result = await runComps(input, makeQlooClient(), PUBLIC_MODEL)
    await addSpend(costUSD(result.model, result.usage))
    await setCached(`report:${key}`, result)
    send(res, 200, result)
  } catch (err) {
    console.error('report failed:', err instanceof Error ? err.message : String(err))
    send(res, 502, { error: 'The research run failed. Please try again in a minute.' })
  }
  return true
}
