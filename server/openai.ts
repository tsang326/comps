/*
 * Minimal OpenAI Chat Completions client (raw HTTP, no SDK): tool calling for
 * the research loop and strict JSON-schema output for the report.
 */
import { z } from 'zod'

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string | null
  tool_calls?: { id: string; type: 'function'; function: { name: string; arguments: string } }[]
  tool_call_id?: string
}
export interface ChatUsage { prompt_tokens: number; completion_tokens: number; prompt_tokens_details?: { cached_tokens?: number } }

/** JSON schema for a zod type, made acceptable to OpenAI strict mode (closed objects, every key required). */
export function strictSchema(schema: z.ZodType): Record<string, unknown> {
  const out = z.toJSONSchema(schema) as Record<string, unknown>
  delete out.$schema
  const walk = (node: unknown) => {
    if (!node || typeof node !== 'object') return
    const n = node as Record<string, unknown>
    if (n.type === 'object' && n.properties && typeof n.properties === 'object') {
      n.additionalProperties = false
      n.required = Object.keys(n.properties as object)
    }
    for (const v of Object.values(n)) Array.isArray(v) ? v.forEach(walk) : walk(v)
  }
  walk(out)
  return out
}

export async function chat(body: {
  model: string
  messages: ChatMessage[]
  tools?: { type: 'function'; function: { name: string; description: string; parameters: Record<string, unknown> } }[]
  response_format?: { type: 'json_schema'; json_schema: { name: string; schema: Record<string, unknown>; strict: true } }
  max_completion_tokens?: number
}): Promise<{ message: ChatMessage; usage: ChatUsage; finish: string }> {
  const key = process.env.OPENAI_API_KEY
  if (!key) throw new Error('OPENAI_API_KEY is not set')
  const res = await fetch(`${process.env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1'}/chat/completions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(120_000),
  })
  if (!res.ok) throw new Error(`OpenAI ${res.status}: ${(await res.text()).slice(0, 300)}`)
  const json = (await res.json()) as { choices: { message: ChatMessage; finish_reason: string }[]; usage: ChatUsage }
  return { message: json.choices[0].message, usage: json.usage, finish: json.choices[0].finish_reason }
}
