import { useEffect, useState } from 'react'
import type { Baseline, RunResult } from '../../server/agent'
import type { Evidence } from '../../server/evidence'

const EXAMPLE = {
  pitch: 'A cozy farming game where you keep a lighthouse running on a small island, befriend the fishing village and restore the coast after storms.',
  comps: 'Stardew Valley, A Short Hike',
}
const REPO = 'https://github.com/tsang326/comps'

const DOMAIN_LABEL: Record<string, string> = {
  podcast: 'Podcasts', artist: 'Artists', tv_show: 'TV shows', brand: 'Brands', book: 'Books',
  movie: 'Movies', destination: 'Destinations', videogame: 'Games', person: 'People', place: 'Places',
}

// 16px line icons, one per Qloo domain
const ICON_PATH: Record<string, string> = {
  podcast: 'M8 1.5a2.5 2.5 0 0 0-2.5 2.5v4a2.5 2.5 0 0 0 5 0V4A2.5 2.5 0 0 0 8 1.5ZM3.5 7.5a4.5 4.5 0 0 0 9 0M8 12v2.5M5.5 14.5h5',
  artist: 'M6 12.5V3l7-1.5V11M6 12.5a2 2 0 1 1-4 0 2 2 0 0 1 4 0ZM13 11a2 2 0 1 1-4 0 2 2 0 0 1 4 0Z',
  tv_show: 'M1.5 4h13v8.5h-13zM5.5 1.5 8 4l2.5-2.5M5 14.5h6',
  brand: 'M1.5 8.5V1.5h7l6 6-7 7-6-6ZM5 5h.01',
  book: 'M2 2.5h4.5A1.5 1.5 0 0 1 8 4v10a1.5 1.5 0 0 0-1.5-1.5H2zM14 2.5H9.5A1.5 1.5 0 0 0 8 4v10a1.5 1.5 0 0 1 1.5-1.5H14z',
  movie: 'M1.5 3h13v10h-13zM4.5 3v10M11.5 3v10M1.5 6.5h3M1.5 9.5h3M11.5 6.5h3M11.5 9.5h3',
  videogame: 'M4 5h8a3 3 0 0 1 3 3v1a3 3 0 0 1-5.2 2H6.2A3 3 0 0 1 1 9V8a3 3 0 0 1 3-3ZM5 7v3M3.5 8.5h3M11 8h.01M12.5 9.5h.01',
}
function DomainIcon({ domain }: { domain: string }) {
  return (
    <svg className="dicon" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
      <path d={ICON_PATH[domain] ?? 'M8 4a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z'} />
    </svg>
  )
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

/** The Qloo entity an item names, looked up in the evidence it cites. */
function findEntity(evidence: Evidence[], ids: string[], name: string) {
  for (const e of evidence) if (ids.includes(e.id)) {
    const hit = e.entities.find((x) => norm(x.name) === norm(name))
    if (hit) return hit
  }
  return undefined
}

type Open = { id: string; name?: string } | null

function EvidenceChips({ ids, name, onOpen }: { ids: string[]; name?: string; onOpen: (o: Open) => void }) {
  return (
    <span className="chips">
      {ids.map((id) => <button key={id} className="chip" onClick={() => onOpen({ id, name })} title="Show the Qloo result behind this">{id}</button>)}
    </span>
  )
}

function Affinity({ value }: { value?: number }) {
  if (value === undefined) return null
  return (
    <span className="aff" title={`Qloo affinity score ${value.toFixed(2)} (0 to 1) for this audience`}>
      <span className="aff-bar"><span style={{ width: `${Math.round(value * 100)}%` }} /></span>
      <span className="aff-num">{value.toFixed(2)}</span>
    </span>
  )
}

const TOOL_LABEL: Record<Evidence['tool'], string> = {
  qloo_search: 'Search', qloo_insights: 'Insights', qloo_tags: 'Tags',
}

function EvidenceDrawer({ ev, names, highlight, onClose }: { ev: Evidence; names: Map<string, string>; highlight?: string; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <>
      <div className="scrim" onClick={onClose} />
      <aside className="drawer" role="dialog" aria-label={`Evidence ${ev.id}`}>
        <header>
          <span className="ev-id">{ev.id}</span>
          <span>Qloo {TOOL_LABEL[ev.tool]}</span>
          <button className="close" onClick={onClose} aria-label="Close">×</button>
        </header>
        <p className="muted small">The exact query the agent sent, and what Qloo returned. The plan may only name things that appear here.</p>
        <dl className="query">
          {Object.entries(ev.input).map(([k, v]) => (
            <div key={k}><dt>{k}</dt><dd>{Array.isArray(v) ? v.map((x) => names.get(String(x)) ?? String(x)).join(', ') : String(v)}</dd></div>
          ))}
        </dl>
        {ev.entities.length + ev.tags.length === 0 && <p className="muted">Qloo returned nothing for this query.</p>}
        <ol className="ents">
          {ev.entities.map((e) => (
            <li key={e.entity_id} className={highlight && norm(e.name) === norm(highlight) ? 'hl' : ''}>
              <span className="ent-name">{e.name}</span>
              <span className="ent-meta">
                <Affinity value={e.affinity} />
                {e.popularity !== undefined && <span className="muted small">popularity {e.popularity.toFixed(2)}</span>}
              </span>
            </li>
          ))}
          {ev.tags.map((t) => <li key={t.tag_id} className={highlight && norm(t.name) === norm(highlight) ? 'hl' : ''}><span className="ent-name">tag: {t.name}</span></li>)}
        </ol>
      </aside>
    </>
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

/** Side by side: the Qloo plan against what the same model suggests with no data. */
function Comparison({ result, baseline }: { result: RunResult; baseline: Baseline }) {
  const qlooNames = new Set(result.report.channels.map((c) => norm(c.name)))
  const inEvidence = new Set(result.evidence.flatMap((e) => e.entities.map((x) => norm(x.name))))
  const both = baseline.channels.filter((c) => qlooNames.has(norm(c.name)))
  const modelOnly = baseline.channels.filter((c) => !qlooNames.has(norm(c.name)))
  const qlooOnly = result.report.channels.filter((c) => !baseline.channels.some((b) => norm(b.name) === norm(c.name)))
  return (
    <section className="card compare">
      <h2>What Qloo adds</h2>
      <p className="muted">The same pitch, given to the same model with no data ({baseline.model}), next to the Qloo-grounded plan. The model's picks often fit the genre; Qloo's show where this audience actually overlaps, which is less obvious and easier to act on.</p>
      <div className="cols">
        <div className="col qloo"><h3>Only with Qloo <span className="count">{qlooOnly.length}</span></h3>
          <ul>{qlooOnly.map((c) => <li key={c.name}><DomainIcon domain={c.domain} />{c.name}</li>)}</ul></div>
        <div className="col both"><h3>Both <span className="count">{both.length}</span></h3>
          <ul>{both.map((c) => <li key={c.name}>{c.name}</li>)}</ul>
          {both.length === 0 && <p className="muted small">No overlap.</p>}</div>
        <div className="col model"><h3>Model alone <span className="count">{modelOnly.length}</span></h3>
          <ul>{modelOnly.map((c) => <li key={c.name}>{c.name}{inEvidence.has(norm(c.name)) && <> <span className="pill ok">in this plan's Qloo results</span></>}</li>)}</ul></div>
      </div>
    </section>
  )
}

const STAGES = [
  { at: 0, label: 'Resolving your comparable titles in Qloo' },
  { at: 8, label: 'Asking what the same audience loves in other domains' },
  { at: 22, label: 'Writing the plan and checking every citation' },
]

function Progress({ elapsed }: { elapsed: number }) {
  const current = STAGES.filter((s) => elapsed >= s.at).length - 1
  return (
    <div className="progress" aria-live="polite">
      <ol>
        {STAGES.map((s, i) => <li key={s.label} className={i < current ? 'done' : i === current ? 'now' : ''}>{s.label}</li>)}
      </ol>
      <p className="muted small">{elapsed}s · usually 30–60 seconds. Steps are estimated from the time so far.</p>
    </div>
  )
}

function SampleCard({ s, active, onOpen }: { s: Sample; active: boolean; onOpen: () => void }) {
  const domains = new Set(s.result.report.channels.map((c) => c.domain))
  const isBook = /novel|book/i.test(s.title)
  return (
    <button className={`sample${active ? ' active' : ''}`} onClick={onOpen}>
      <span className="sample-kind">{isBook ? 'Book' : 'Game'}{s.input.reach === 'reachable' && ' · small budget'}</span>
      <span className="sample-title">{s.title}</span>
      <span className="sample-comps">like {s.input.comps.join(', ')}</span>
      <span className="sample-meta">{s.result.report.channels.length} channels · {domains.size} domains · {s.result.evidence.length} Qloo queries</span>
    </button>
  )
}

export default function App() {
  const [samples, setSamples] = useState<Sample[]>([])
  const [ran, setRan] = useState<Sample['input'] | null>(null)
  const [active, setActive] = useState<string | null>(null)
  const [pitch, setPitch] = useState(EXAMPLE.pitch)
  const [comps, setComps] = useState(EXAMPLE.comps)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<RunResult | null>(null)
  const [reach, setReach] = useState<'any' | 'reachable'>('any')
  const [baseline, setBaseline] = useState<Baseline | null>(null)
  const [comparing, setComparing] = useState(false)
  const [open, setOpen] = useState<Open>(null)
  const [elapsed, setElapsed] = useState(0)
  useEffect(() => {
    fetch('/api/samples').then((r) => r.json()).then((s) => Array.isArray(s) && setSamples([...s].sort((a: Sample, b: Sample) => Number(b.input.reach === 'reachable') - Number(a.input.reach === 'reachable')))).catch(() => {})
  }, [])
  useEffect(() => {
    if (!busy) return
    setElapsed(0)
    const t = setInterval(() => setElapsed((e) => e + 1), 1000)
    return () => clearInterval(t)
  }, [busy]) // eslint-disable-line react-hooks/exhaustive-deps

  const scrollToReport = () => requestAnimationFrame(() => document.getElementById('report')?.scrollIntoView({ behavior: 'smooth', block: 'start' }))

  const showSample = (s: Sample) => {
    setActive(s.slug); setPitch(s.input.pitch); setComps(s.input.comps.join(', ')); setReach(s.input.reach ?? 'any')
    setError(null); setOpen(null); setResult(s.result); setBaseline(s.baseline ?? null); setRan(s.input)
    scrollToReport()
  }

  async function run() {
    setBusy(true); setError(null); setResult(null); setOpen(null); setBaseline(null); setActive(null)
    const input = { pitch, comps: comps.split(/[,;\n]/).map((c) => c.trim()).filter(Boolean), reach }
    try {
      const res = await fetch('/api/report', {
        method: 'POST',
        headers: HEADERS,
        body: JSON.stringify(input),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`)
      setResult(data); setRan(input)
      scrollToReport()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  async function compare() {
    setComparing(true); setError(null)
    try {
      const res = await fetch('/api/baseline', { method: 'POST', headers: HEADERS, body: JSON.stringify({ pitch: ran?.pitch ?? pitch, comps: ran?.comps ?? [] }) })
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
  const ev = open ? result?.evidence.find((e) => e.id === open.id) : undefined
  const byDomain: Record<string, NonNullable<typeof r>['channels']> = {}
  for (const c of r?.channels ?? []) (byDomain[c.domain] ??= []).push(c)
  const sample = samples.find((s) => s.slug === active)
  const names = new Map((result?.evidence ?? []).flatMap((e) => e.entities.map((x) => [x.entity_id, x.name] as [string, string])))
  const typed = new Set((ran?.comps ?? []).map(norm))

  return (
    <>
      <nav className="top">
        <span className="brand"><span className="mark" aria-hidden="true">◐</span>Comps</span>
        <span className="muted small hide-sm">Launch research on Qloo's taste data</span>
        <a className="gh" href={REPO} target="_blank" rel="noreferrer">GitHub</a>
      </nav>

      <main>
        <header className="hero">
          <p className="eyebrow">For indie game developers and self-published authors</p>
          <h1>Find the audience your game or book already has, <em>and where else they spend their attention.</em></h1>
          <p className="lede">Describe your project. An agent asks Qloo what fans of similar titles also love in podcasts, music, TV, books and brands, then writes a launch plan where every recommendation links to the data behind it.</p>
        </header>

        <div className="split">
          <section className="card form" aria-label="Your project">
            <label>Your pitch
              <textarea value={pitch} onChange={(e) => setPitch(e.target.value)} rows={4} maxLength={600} />
            </label>
            <label>Comparable titles <span className="muted normal">optional, comma separated</span>
              <input value={comps} onChange={(e) => setComps(e.target.value)} placeholder="Stardew Valley, A Short Hike" />
            </label>
            <label className="check"><input type="checkbox" checked={reach === 'reachable'} onChange={(e) => setReach(e.target.checked ? 'reachable' : 'any')} />
              <span><b>Small budget</b><br /><span className="muted">Favour channels a small team can actually reach: less mainstream podcasts, artists and shows.</span></span></label>
            <button className="primary" onClick={run} disabled={busy}>{busy ? 'Researching with Qloo…' : 'Build my launch plan'}</button>
            {busy && <Progress elapsed={elapsed} />}
            {error && <p className="error">{error}</p>}
          </section>

          <aside className="how" aria-label="How it works">
            <h2>How it works</h2>
            <ol>
              <li><b>Resolve your comps.</b> Your titles are matched to Qloo entities (or the agent picks a few that fit).</li>
              <li><b>Cross the domains.</b> Qloo Insights returns what that audience over-indexes on in other categories.</li>
              <li><b>Plan with receipts.</b> Every item cites a Qloo result. Anything the data does not back is removed and listed.</li>
            </ol>
          </aside>
        </div>

        {samples.length > 0 && (
          <section className="samples" aria-label="Finished plans">
            <h2>Or open a finished plan</h2>
            <div className="sample-grid">
              {samples.map((s) => <SampleCard key={s.slug} s={s} active={s.slug === active} onOpen={() => showSample(s)} />)}
            </div>
          </section>
        )}

        {result && r && (
          <article className="report" id="report">
            {result.qlooMode === 'mock' && <p className="banner">Demo mode: Qloo data below is synthetic (marked “mock”).</p>}

            <header className="report-head">
              <p className="eyebrow">Launch plan{sample ? ` · ${sample.title}` : ''}</p>
              <blockquote>{ran?.pitch ?? pitch}</blockquote>
              <dl className="stats">
                <div><dt>Qloo queries</dt><dd>{result.evidence.length}</dd></div>
                <div><dt>Channels</dt><dd>{r.channels.length}</dd></div>
                <div><dt>Domains</dt><dd>{Object.keys(byDomain).length}</dd></div>
                <div><dt>Removed as unbacked</dt><dd>{r.dropped.length}</dd></div>
              </dl>
            </header>

            <section className="card audience">
              <h2>Who this is for <span className="tag soft">summary written from the evidence below</span></h2>
              <p>{r.audience_summary}</p>
            </section>

            {r.comps.length > 0 && (
              <section className="card">
                <h2>Comparable titles</h2>
                <div className="comp-grid">
                  {r.comps.map((c) => (
                    <div key={c.name} className="comp">
                      <b>{c.name}</b> <span className="pill">{typed.has(norm(c.name)) ? 'your title' : 'found by Qloo'}</span>
                      <p>{c.why}</p>
                      <EvidenceChips ids={c.evidence} name={c.name} onOpen={setOpen} />
                    </div>
                  ))}
                </div>
              </section>
            )}

            <section className="card">
              <h2>Where to reach them</h2>
              <p className="muted small">Bars show Qloo's affinity score for this audience; popularity (0 to 1) is how mainstream the item is. Expect surprises: taste overlaps cross genres (fans of a cozy game may also love a horror audio drama). Those overlaps are the point, and each one links to the query that found it.</p>
              <div className="domains">
                {Object.entries(byDomain).map(([domain, items]) => (
                  <div key={domain} className="domain">
                    <h3><DomainIcon domain={domain} />{DOMAIN_LABEL[domain] ?? domain}</h3>
                    <ul>
                      {items.map((c) => {
                        const ent = findEntity(result.evidence, c.evidence, c.name)
                        return (
                          <li key={c.name}>
                            <div className="ch-top"><b>{c.name}</b><Affinity value={ent?.affinity} /></div>
                            {ent?.popularity !== undefined && <span className="muted small">popularity {ent.popularity.toFixed(2)}</span>}
                            <p>{c.action}</p>
                            <EvidenceChips ids={c.evidence} name={c.name} onOpen={setOpen} />
                          </li>
                        )
                      })}
                    </ul>
                  </div>
                ))}
              </div>
            </section>

            {r.positioning.length > 0 && (
              <section className="card">
                <h2>Positioning</h2>
                <ul className="plain">{r.positioning.map((p) => <li key={p.point}>{p.point} <span className="pill">{p.name}</span> <EvidenceChips ids={p.evidence} name={p.name} onOpen={setOpen} /></li>)}</ul>
              </section>
            )}

            {r.interpretation && (
              <section className="card interpretation">
                <h2>Our interpretation <span className="tag">not Qloo data</span></h2>
                <p>{r.interpretation}</p>
              </section>
            )}

            {baseline ? <Comparison result={result} baseline={baseline} /> : (
              <section className="card compare">
                <h2>What Qloo adds</h2>
                <p className="muted">See what a model suggests for the same pitch with no data, next to this plan.</p>
                <button className="secondary" onClick={compare} disabled={comparing}>{comparing ? 'Asking the model alone…' : 'Compare with a model alone'}</button>
              </section>
            )}

            <section className="card limits">
              <h2>What this does not tell you</h2>
              <ul>{r.limits.map((l) => <li key={l}>{l}</li>)}</ul>
              {r.dropped.length > 0 && (
                <p className="muted">Removed {r.dropped.length} suggestion{r.dropped.length > 1 ? 's' : ''} the evidence did not back: {r.dropped.map((d) => d.name.length > 40 ? d.name.slice(0, 40) + '…' : d.name).join(', ')}.</p>
              )}
              {r.repaired.length > 0 && (
                <p className="muted">Corrected {r.repaired.length} citation{r.repaired.length > 1 ? 's' : ''} that pointed at the wrong Qloo result (the item was in the data, just under another query).</p>
              )}
            </section>
          </article>
        )}

        <footer className="muted small">Qloo results describe what groups of people tend to like, not what any one person will do. · <a href={REPO} target="_blank" rel="noreferrer">Source on GitHub</a></footer>
      </main>

      {ev && <EvidenceDrawer ev={ev} names={names} highlight={open?.name} onClose={() => setOpen(null)} />}
    </>
  )
}
