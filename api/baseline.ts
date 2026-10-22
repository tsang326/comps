import type { IncomingMessage, ServerResponse } from 'node:http'
import { handleBaseline } from '../server/handler.js'

// One structured model call
export const config = { maxDuration: 120 }

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  if (!(await handleBaseline(req, res))) {
    res.writeHead(404, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: 'Not found.' }))
  }
}
