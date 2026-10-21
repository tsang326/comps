/*
 * POST /api/report { pitch, comps[] } -> report + evidence.
 * Shared by the local dev server and the Vercel function.
 * Keys stay server-side; results are cached by input and requests are rate
 * limited so the public demo survives the judging period.
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import { createHash } from 'node:crypto'
import { runComps, type RunResult } from './agent.js'
import { makeQlooClient } from './qloo.js'

const MAX_PITCH = 600
const MAX_COMPS = 4
const PER_IP_PER_HOUR = 5

const cache = new Map<string, RunResult>()
const hits = new Map<string, number[]>()

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

export function parseInput(body: unknown): { pitch: string; comps: string[] } | string {
  const b = body as { pitch?: unknown; comps?: unknown }
  const pitch = typeof b.pitch === 'string' ? b.pitch.trim() : ''
  if (pitch.length < 20) return 'Describe your game or book in at least a sentence.'
  if (pitch.length > MAX_PITCH) return `Keep the pitch under ${MAX_PITCH} characters.`
  const comps = Array.isArray(b.comps)
    ? b.comps.filter((c): c is string => typeof c === 'string').map((c) => c.trim()).filter(Boolean).slice(0, MAX_COMPS)
    : []
  if (comps.some((c) => c.length > 80)) return 'Each comparable title should be under 80 characters.'
  return { pitch, comps }
}

function rateLimited(ip: string, now = Date.now()) {
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < 3_600_000)
  if (recent.length >= PER_IP_PER_HOUR) return true
  hits.set(ip, [...recent, now])
  return false
}

export async function handleReport(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
  if (req.method !== 'POST' || !req.url?.startsWith('/api/report')) return false
  let body: unknown
  try { body = await readJson(req) } catch { send(res, 400, { error: 'Invalid JSON body.' }); return true }

  const input = parseInput(body)
  if (typeof input === 'string') { send(res, 422, { error: input }); return true }

  const key = createHash('sha256').update(JSON.stringify(input).toLowerCase()).digest('hex')
  const cached = cache.get(key)
  if (cached) { send(res, 200, { ...cached, cached: true }); return true }

  const ip = String(req.headers['x-forwarded-for'] ?? req.socket.remoteAddress ?? 'unknown').split(',')[0].trim()
  if (rateLimited(ip)) { send(res, 429, { error: 'Too many new reports from this address; try again in an hour or open a sample report.' }); return true }

  try {
    const result = await runComps(input, makeQlooClient())
    cache.set(key, result)
    send(res, 200, result)
  } catch (err) {
    console.error('report failed:', err instanceof Error ? err.message : String(err))
    send(res, 502, { error: 'The research run failed. Please try again in a minute.' })
  }
  return true
}
