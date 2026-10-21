import type { IncomingMessage, ServerResponse } from 'node:http'
import { handleReport } from '../server/handler.js'

// A research run makes several model and Qloo calls
export const config = { maxDuration: 300 }

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  if (!(await handleReport(req, res))) {
    res.writeHead(404, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: 'Not found.' }))
  }
}
