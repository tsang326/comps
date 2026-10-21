/**
 * Local development server for the API (Vite proxies /api -> :3001).
 * On Vercel the same handler runs as a function in /api.
 */
import { createServer } from 'node:http'
import { handleReport } from './handler.js'
import { makeQlooClient } from './qloo.js'

const PORT = 3001

createServer(async (req, res) => {
  if (await handleReport(req, res)) return
  if (req.method === 'GET' && req.url === '/api/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ ok: true, qloo: makeQlooClient().mode }))
    return
  }
  res.writeHead(404, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({ error: 'Not found.' }))
}).listen(PORT, () => console.log(`Comps API on :${PORT} (qloo: ${makeQlooClient().mode})`))
