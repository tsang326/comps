/*
 * Sample reports shown on the landing page. They contain real Qloo results,
 * and the rules forbid storing Qloo response data in a public repository, so
 * they live outside git: Upstash Redis when configured (deployed demo),
 * otherwise cache/samples.json (gitignored, local only).
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { Redis } from '@upstash/redis'
import type { RunInput, RunResult } from './agent.js'

export interface Sample { slug: string; title: string; input: RunInput; result: RunResult; createdAt: string }

const KEY = 'comps:samples'
const FILE = new URL('../cache/samples.json', import.meta.url)

function redis() {
  const url = process.env.KV_REST_API_URL, token = process.env.KV_REST_API_TOKEN
  return url && token ? new Redis({ url, token }) : null
}

export async function loadSamples(): Promise<Sample[]> {
  const r = redis()
  if (r) return (await r.get<Sample[]>(KEY)) ?? []
  try { return JSON.parse(await readFile(FILE, 'utf8')) as Sample[] } catch { return [] }
}

export async function saveSamples(samples: Sample[]): Promise<void> {
  const r = redis()
  if (r) { await r.set(KEY, samples); return }
  await mkdir(new URL('../cache/', import.meta.url), { recursive: true })
  await writeFile(FILE, JSON.stringify(samples, null, 2))
}
