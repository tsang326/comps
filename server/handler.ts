/*
 * POST /api/report { pitch, comps[] } -> report + evidence.
 * Shared by the local dev server and the Vercel function.
 * Keys stay server-side; results are cached by input and requests are rate
 * limited so the public demo survives the judging period.
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import { createHash } from 'node:crypto'
import { MODEL, runBaseline, runComps, type Baseline, type Reach, type RunResult } from './agent.js'
import { makeQlooClient } from './qloo.js'
import { loadSamples, redis } from './samples.js'

const MAX_PITCH = 600
const MAX_COMPS = 4
const PER_IP_PER_HOUR = 5
// Model for new public runs (OpenAI); the daily cap bounds what a burst of traffic can cost.
const PUBLIC_MODEL = process.env.COMPS_PUBLIC_MODEL ?? MODEL
const DAILY_CAP = Number(process.env.COMPS_DAILY_CAP ?? 50)

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

const overDailyCap = async () => (await countUse(`day:${new Date().toISOString().slice(0, 10)}`, 2 * 86_400)) > DAILY_CAP
const rateLimited = async (ip: string, bucket = 'report') => (await countUse(`${bucket}:${ip}:${new Date().toISOString().slice(0, 13)}`, 3600)) > PER_IP_PER_HOUR

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
  const key = createHash('sha256').update(JSON.stringify({ pitch: input.pitch, comps: input.comps }).toLowerCase()).digest('hex')
  const cached = await getCached<Baseline>(`baseline:${key}`)
  if (cached) { send(res, 200, cached); return true }
  if (await rateLimited(clientIp(req), 'baseline')) { send(res, 429, { error: 'Too many comparisons from this address; try again in an hour.' }); return true }
  try {
    const b = await runBaseline(input)
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

  const key = createHash('sha256').update(JSON.stringify(input).toLowerCase()).digest('hex')
  const cached = await getCached<RunResult>(`report:${key}`)
  if (cached) { send(res, 200, { ...cached, cached: true }); return true }

  if (await overDailyCap()) { send(res, 429, { error: 'Today\'s free reports are used up; open a sample report, or try again tomorrow.' }); return true }
  if (await rateLimited(clientIp(req))) { send(res, 429, { error: 'Too many new reports from this address; try again in an hour or open a sample report.' }); return true }

  try {
    const result = await runComps(input, makeQlooClient(), PUBLIC_MODEL)
    await setCached(`report:${key}`, result)
    send(res, 200, result)
  } catch (err) {
    console.error('report failed:', err instanceof Error ? err.message : String(err))
    send(res, 502, { error: 'The research run failed. Please try again in a minute.' })
  }
  return true
}
