import type { IncomingMessage, ServerResponse } from 'node:http'
import { handleSamples } from '../server/handler.js'

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  if (!(await handleSamples(req, res))) {
    res.writeHead(404, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: 'Not found.' }))
  }
}
