import { useEffect, useState } from 'react'
import type { Baseline, RunResult } from '../../server/agent'
import type { Evidence } from '../../server/evidence'

const EXAMPLE = {
  pitch: 'A cozy farming game where you keep a lighthouse running on a small island, befriend the fishing village and restore the coast after storms.',
  comps: 'Stardew Valley, A Short Hike',
}

const DOMAIN_LABEL: Record<string, string> = {
  podcast: 'Podcasts', artist: 'Artists', tv_show: 'TV shows', brand: 'Brands', book: 'Books',
  movie: 'Movies', destination: 'Destinations', videogame: 'Games', person: 'People', place: 'Places',
}

function EvidenceChips({ ids, onOpen }: { ids: string[]; onOpen: (id: string) => void }) {
  return (
    <span className="chips">
      {ids.map((id) => <button key={id} className="chip" onClick={() => onOpen(id)} title="Show the Qloo result behind this">{id}</button>)}
    </span>
  )
}

function EvidencePanel({ ev, onClose }: { ev: Evidence; onClose: () => void }) {
  return (
    <aside className="evidence" role="dialog" aria-label={`Evidence ${ev.id}`}>
      <header><b>{ev.id}</b> · {ev.tool} <button className="link" onClick={onClose}>close</button></header>
      <pre className="input">{JSON.stringify(ev.input)}</pre>
      {ev.entities.length + ev.tags.length === 0 && <p className="muted">Qloo returned nothing for this query.</p>}
      <ul>
        {ev.entities.map((e) => (
          <li key={e.entity_id}>
            {e.name}
            {e.affinity !== undefined && <span className="muted"> · affinity {e.affinity}</span>}
            {e.popularity !== undefined && <span className="muted"> · popularity {e.popularity}</span>}
          </li>
        ))}
        {ev.tags.map((t) => <li key={t.tag_id}>tag: {t.name}</li>)}
      </ul>
    </aside>
  )
}

interface Sample { slug: string; title: string; input: { pitch: string; comps: string[]; reach?: 'any' | 'reachable' }; result: RunResult; baseline?: Baseline }

// A random id kept in this browser: the server limits new reports per device as well as per IP
const DEVICE_ID = (() => {
  try {
    const k = 'comps-device'
    const v = localStorage.getItem(k) ?? crypto.randomUUID()
    localStorage.setItem(k, v)
    return v
  } catch { return crypto.randomUUID() }
})()
const HEADERS = { 'Content-Type': 'application/json', 'X-Device-Id': DEVICE_ID }

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

/** Side by side: the Qloo plan against what the same model suggests with no data. */
function Comparison({ result, baseline }: { result: RunResult; baseline: Baseline }) {
  const qlooNames = new Set(result.report.channels.map((c) => norm(c.name)))
  const inEvidence = new Set(result.evidence.flatMap((e) => e.entities.map((x) => norm(x.name))))
  const both = baseline.channels.filter((c) => qlooNames.has(norm(c.name)))
  const modelOnly = baseline.channels.filter((c) => !qlooNames.has(norm(c.name)))
  const qlooOnly = result.report.channels.filter((c) => !baseline.channels.some((b) => norm(b.name) === norm(c.name)))
  return (
    <div className="card compare">
      <h2>What Qloo adds</h2>
      <p className="muted">The same pitch, given to a model with no data ({baseline.model}), against the Qloo-grounded plan above.</p>
      <div className="cols">
        <div><h3>Only with Qloo <span className="count">{qlooOnly.length}</span></h3>
          <ul>{qlooOnly.map((c) => <li key={c.name}>{c.name} <span className="muted">{DOMAIN_LABEL[c.domain] ?? c.domain}</span></li>)}</ul></div>
        <div><h3>Both <span className="count">{both.length}</span></h3>
          <ul>{both.map((c) => <li key={c.name}>{c.name}</li>)}</ul></div>
        <div><h3>Model alone <span className="count">{modelOnly.length}</span></h3>
          <ul>{modelOnly.map((c) => <li key={c.name}>{c.name} <span className="muted">{inEvidence.has(norm(c.name)) ? 'also in Qloo data' : 'no Qloo signal'}</span></li>)}</ul></div>
      </div>
    </div>
  )
}

export default function App() {
  const [samples, setSamples] = useState<Sample[]>([])
  const [pitch, setPitch] = useState(EXAMPLE.pitch)
  const [comps, setComps] = useState(EXAMPLE.comps)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<RunResult | null>(null)
  const [reach, setReach] = useState<'any' | 'reachable'>('any')
  const [baseline, setBaseline] = useState<Baseline | null>(null)
  const [comparing, setComparing] = useState(false)
  const [open, setOpen] = useState<string | null>(null)
  const [elapsed, setElapsed] = useState(0)
  useEffect(() => {
    fetch('/api/samples').then((r) => r.json()).then((s) => Array.isArray(s) && setSamples(s)).catch(() => {})
  }, [])
  useEffect(() => {
    if (!busy) return
    setElapsed(0)
    const t = setInterval(() => setElapsed((e) => e + 1), 1000)
    return () => clearInterval(t)
  }, [busy]) // eslint-disable-line react-hooks/exhaustive-deps

  const showSample = (s: Sample) => {
    setPitch(s.input.pitch); setComps(s.input.comps.join(', ')); setReach(s.input.reach ?? 'any'); setError(null); setOpen(null); setResult(s.result); setBaseline(s.baseline ?? null)
  }

  async function run() {
    setBusy(true); setError(null); setResult(null); setOpen(null); setBaseline(null)
    try {
      const res = await fetch('/api/report', {
        method: 'POST',
        headers: HEADERS,
        body: JSON.stringify({ pitch, comps: comps.split(/[,;\n]/), reach }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`)
      setResult(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  async function compare() {
    setComparing(true); setError(null)
    try {
      const res = await fetch('/api/baseline', { method: 'POST', headers: HEADERS, body: JSON.stringify({ pitch, comps: comps.split(/[,;\n]/) }) })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`)
      setBaseline(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setComparing(false)
    }
  }

  const r = result?.report
  const ev = open ? result?.evidence.find((e) => e.id === open) : undefined
  const byDomain: Record<string, NonNullable<typeof r>['channels']> = {}
  for (const c of r?.channels ?? []) (byDomain[c.domain] ??= []).push(c)

  return (
    <main>
      <header className="hero">
        <h1>Comps</h1>
        <p>Find out who your indie game or book is for, and where to reach them. Built on Qloo's taste data: every recommendation shows the signal behind it.</p>
      </header>

      {samples.length > 0 && (
        <section className="samples">
          <span className="muted">See a finished plan:</span>
          {samples.map((s) => <button key={s.slug} className="sample" onClick={() => showSample(s)}>{s.title}</button>)}
        </section>
      )}

      <section className="card form">
        <label>Your pitch
          <textarea value={pitch} onChange={(e) => setPitch(e.target.value)} rows={3} maxLength={600} />
        </label>
        <label>Comparable titles (optional, comma separated)
          <input value={comps} onChange={(e) => setComps(e.target.value)} placeholder="Stardew Valley, A Short Hike" />
        </label>
        <label className="check"><input type="checkbox" checked={reach === 'reachable'} onChange={(e) => setReach(e.target.checked ? 'reachable' : 'any')} />
          Small budget: favour channels a small team can actually reach (less mainstream podcasts, artists and shows)</label>
        <button className="primary" onClick={run} disabled={busy}>{busy ? `Researching with Qloo… ${elapsed}s` : 'Build my launch plan'}</button>
        {busy && <p className="muted">The agent resolves your comps, asks Qloo what the same audience likes in other domains, then writes the plan. Usually 30–60 seconds.</p>}
        {error && <p className="error">{error}</p>}
      </section>

      {result && r && (
        <section className="report">
          {result.qlooMode === 'mock' && <p className="banner">Demo mode: Qloo data below is synthetic (marked “mock”).</p>}

          <div className="card">
            <h2>Who this is for</h2>
            <p>{r.audience_summary}</p>
          </div>

          {r.comps.length > 0 && (
            <div className="card">
              <h2>Comparable titles</h2>
              <ul>{r.comps.map((c) => <li key={c.name}><b>{c.name}</b> — {c.why} <EvidenceChips ids={c.evidence} onOpen={setOpen} /></li>)}</ul>
            </div>
          )}

          <div className="card">
            <h2>Where to reach them</h2>
            {Object.entries(byDomain).map(([domain, items]) => (
              <div key={domain} className="domain">
                <h3>{DOMAIN_LABEL[domain] ?? domain}</h3>
                <ul>{items.map((c) => <li key={c.name}><b>{c.name}</b> — {c.action} <EvidenceChips ids={c.evidence} onOpen={setOpen} /></li>)}</ul>
              </div>
            ))}
          </div>

          {r.positioning.length > 0 && (
            <div className="card">
              <h2>Positioning</h2>
              <ul>{r.positioning.map((p) => <li key={p.point}>{p.point} <span className="muted">({p.name})</span> <EvidenceChips ids={p.evidence} onOpen={setOpen} /></li>)}</ul>
            </div>
          )}

          {r.interpretation && (
            <div className="card interpretation">
              <h2>Our interpretation <span className="tag">not Qloo data</span></h2>
              <p>{r.interpretation}</p>
            </div>
          )}

          {baseline ? <Comparison result={result} baseline={baseline} /> : (
            <div className="card compare">
              <h2>What Qloo adds</h2>
              <p className="muted">See what a model suggests for the same pitch with no data, next to this plan.</p>
              <button onClick={compare} disabled={comparing}>{comparing ? 'Asking the model alone…' : 'Compare with a model alone'}</button>
            </div>
          )}

          <div className="card">
            <h2>What this does not tell you</h2>
            <ul>{r.limits.map((l) => <li key={l}>{l}</li>)}</ul>
            {r.dropped.length > 0 && (
              <p className="muted">Removed {r.dropped.length} suggestion{r.dropped.length > 1 ? 's' : ''} the evidence did not back: {r.dropped.map((d) => d.name).join(', ')}.</p>
            )}
          </div>
        </section>
      )}

      {ev && <EvidencePanel ev={ev} onClose={() => setOpen(null)} />}
      <footer className="muted">Qloo results describe what groups of people tend to like, not what any one person will do.</footer>
    </main>
  )
}
