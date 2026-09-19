import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ChangeEvent, FormEvent } from 'react'
import { api, apiOrigin, downloadResult, rememberJob, restoreJob } from './api'
import type { Capabilities, Credentials, Job, ModelId, Mode, ResultRow, Results, Submission } from './api'
import { exampleFasta, exampleGuide, exampleSites, exampleTable, validateInput } from './input'

const repository = 'https://github.com/Alexander-Mitrofanov/OfftargetPred-web-server'
const terminal = (status: string) => ['complete', 'completed', 'failed', 'cancelled'].includes(status)
const successful = (status?: string) => status === 'complete' || status === 'completed'
const message = (error: unknown) => error instanceof Error ? error.message : 'The request could not be completed.'
const date = (value?: string) => value ? new Date(value).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '—'

function Mark() {
  return <svg viewBox="0 0 42 42" aria-hidden="true"><rect width="42" height="42" rx="9" fill="currentColor" /><g stroke="white" strokeWidth="2.5" strokeLinecap="round"><path d="M10 12h22M10 30h22M12 17v8M19 17v8M30 17v8" /></g><path d="m23 17 4 8" stroke="#65d3c4" strokeWidth="2.5" strokeLinecap="round" /></svg>
}
function Arrow({ down = false }: { down?: boolean }) { return <svg viewBox="0 0 20 20" aria-hidden="true"><path d={down ? 'M10 3v10m-4-4 4 4 4-4M4 15v2h12v-2' : 'M4 10h12m-5-5 5 5-5 5'} fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" /></svg> }
function Sequence({ sequence, guide, label }: { sequence: string; guide?: string; label?: string }) {
  return <code className="sequence" aria-label={`${label ? label + ': ' : ''}${sequence}`}>
    {sequence.split('').map((base, i) => <span key={i} aria-hidden="true" className={`${i === 20 ? 'pam-start ' : ''}${i >= 20 ? 'pam ' : ''}${base === 'N' ? 'unknown ' : guide && guide[i] !== base && guide[i] !== 'N' ? 'mismatch' : ''}`}>{base}</span>)}
  </code>
}
function AlignmentExample() {
  return <div className="alignment-example"><div className="alignment-legend"><span>20-base protospacer</span><span>PAM</span></div><div className="alignment-row"><span className="sequence-label">Guide</span><Sequence sequence={exampleGuide} /></div><div className="alignment-row"><span className="sequence-label">Site</span><Sequence sequence="GTTGCTCTTCAGAATCACTGAGG" guide={exampleGuide} /></div><p><span className="mismatch-swatch" /> Highlighted bases differ from the guide.</p></div>
}

function Documentation({ page, capabilities }: { page: 'help' | 'about'; capabilities: Capabilities | null }) {
  return <div className="documentation"><header className="page-intro"><h1>{page === 'help' ? 'From sequences to scores' : 'The models behind the scores'}</h1><p>{page === 'help' ? 'Input formats, search boundaries and practical guidance for reading your results.' : 'OfftargetPred runs three sequence-only CRISPert models for candidate off-target assessment.'}</p></header>
    {page === 'help' ? <>
      <section><h2>Choose your starting point</h2><p><strong>Candidate pairs:</strong> bring sites from your own search or experiment. Score one guide against a list of sites, or upload pairs for multiple guides. No genome search is performed in this mode.</p><p><strong>Genome search:</strong> find NGG-PAM candidates for up to {capabilities?.limits.guides ?? 10} guides in the installed human GRCh38 reference, then score those candidates. Search supports up to four substitutions in the 20-base protospacer, both strands, and no bulges. Availability is shown in the form.</p><p>Genome search covers the installed reference assembly; individual variants and uninstalled alternate sequences are outside its scope. A search exceeding the candidate limit fails with an explanation instead of returning an undisclosed truncated list.</p></section>
      <section><h2>Two aligned sequences, 23 bases each</h2><p>Provide guide and candidate DNA in the same 5′ to 3′ orientation. Each sequence must contain a 20-base protospacer followed by its 3-base PAM. Use the actual guide-side PAM, not a 20-base RNA guide alone. The server does not reverse-complement or realign your input.</p><AlignmentExample /><p>Candidate-pair scoring accepts A, C, G, T and N, regardless of case. N produces unknown tokens and is flagged. Gaps, bulges, U and other ambiguity codes are unsupported. Genome-search guides require unambiguous A/C/G/T bases and an NGG PAM. Candidate-pair scoring accepts other candidate PAMs; acceptance does not establish their experimental validity.</p></section>
      <section><h2>CSV or TSV input</h2><p>The simplest table has <code>target</code> and <code>off_target</code> columns. An optional <code>ID</code> identifies each pair. Do not include experimental labels unless you need them as metadata; labels are not required to predict.</p><pre><code>{exampleTable}</code></pre><a href={`${import.meta.env.BASE_URL}examples/candidate-pairs.csv`} download>Download the example CSV</a><div className="table-scroll"><table className="help-table"><thead><tr><th>Meaning</th><th>Accepted column names</th></tr></thead><tbody><tr><td>Guide + PAM</td><td><code>target</code>, <code>sgRNA</code>, <code>Guide_sequence</code>, <code>AlignedTarget</code></td></tr><tr><td>Candidate + PAM</td><td><code>off_target</code>, <code>offtarget</code>, <code>Target_sequence</code>, <code>AlignedText</code></td></tr></tbody></table></div><p>Names are case-sensitive. Choose one alias for each sequence column. In the CRISPROfft convention, <code>Target_sequence</code> is the genomic candidate, while <code>Guide_sequence</code> is the guide. Invalid rows are reported; they are not silently removed.</p></section>
      <section><h2>Genome-search input</h2><p>Paste one 23-base guide per line, or FASTA with a unique identifier for each guide. A longer target region is not accepted for guide design.</p><pre><code>{exampleFasta}</code></pre><p>Search results include reference positions and strands. Exact protospacer matches are kept and labeled: an exact match alone does not establish that a genomic locus is your intended target. Mismatch counts exclude the PAM. Reference provenance and coordinate convention are included with the server’s result metadata.</p></section>
      <section><h2>Read a CRISPert score</h2><p>Each score is the model’s positive-class softmax output, between 0 and 1. Larger values indicate stronger model support for an off-target signal. These values are <strong>not calibrated cleavage probabilities or predicted editing percentages</strong>. There is no validated universal safe/unsafe threshold.</p><p>Compare the k=1, k=2 and k=3 columns directly. No ensemble average is computed. Model disagreement is useful context, and no model wins on every held-out dataset. Scores do not measure guide-level genome-wide specificity, particularly when scoring an incomplete list of candidates.</p></section>
      <section><h2>Jobs and data</h2><p>{capabilities ? `The current server accepts up to ${capabilities.limits.pairs.toLocaleString()} pairs per scoring job, ${capabilities.limits.guides} guides per search, and ${capabilities.limits.candidates.toLocaleString()} search candidates. Inputs and results expire after ${capabilities.retention_hours} hours.` : 'The form reads current input limits and result-retention settings from the prediction server when connected.'} Download the full CSV for analysis, or the JSON export for results and provenance.</p><p>Your browser tab keeps a private job-access token in session storage. It is not sent in URLs to the server. Use Copy private result link to reopen completed results in another browser. That link grants access to anyone who has it; its access token is read from the link fragment and removed from the address bar. The job ID alone cannot recover private results. Download results before they expire. You can delete a job and its submitted data from the results panel. No email is required.</p></section>
    </> : <>
      <section><h2>Sequence-only CRISPert</h2><p>The guide and candidate are aligned position by position. Each pair of bases is encoded in a 16-symbol pair alphabet, preserving both the matched bases and the direction of each mismatch. Overlapping k-mers group one, two or three aligned positions per token.</p><p>All three supplied checkpoints use four BERT layers, a hidden size of 128, four attention heads and a feed-forward size of 256. Scoring uses sequence alone; chromatin, epigenetic and CasKAS features are not used.</p><div className="table-scroll"><table className="help-table"><thead><tr><th>Model</th><th>Positions / token</th><th>Parameters</th><th>Pretraining</th></tr></thead><tbody><tr><td>k=1 <span className="small-tag">Default</span></td><td>1</td><td>552,962</td><td>From scratch</td></tr><tr><td>k=2</td><td>2</td><td>583,554</td><td>Synthetic pair masking</td></tr><tr><td>k=3</td><td>3</td><td>1,074,946</td><td>Synthetic pair masking</td></tr></tbody></table></div></section>
      <section><h2>What these checkpoints were trained on</h2><p>These are the seed-0 models trained using a stratified split across the full 17-guide T-cell GUIDE-seq set. Performance on that same T-cell set is not evidence of generalization. The supplied K562 and iPSC datasets provide held-out cross-cell evaluations.</p><p>k=1 is the recommended default based on the supplied model documentation and leave-one-guide-out comparisons. k=2 and k=3 perform better on some external datasets, which is why this server exposes all three independently. The iPSC evaluation includes only two guides, one with no positive sites; its per-guide average should not drive model selection.</p></section>
      <section><h2>Method and manuscript provenance</h2><p>The manuscript included with the supplied model package describes the broader CRISPert work, including a larger architecture and CasKAS experiments. This server uses the packaged four-layer, sequence-only checkpoints described in the package README. Manuscript performance numbers must not be attributed to these checkpoints without a matching evaluation.</p><p>Each completed run records model and reference metadata with its results. Keep the JSON export alongside your CSV when preparing a reproducible analysis.</p></section>
      <section><h2>Scope and interpretation</h2><p>OfftargetPred ranks candidate sites. It does not estimate therapeutic safety, on-target editing efficiency, chromatin accessibility, or cell-specific cleavage. Reference search and candidate scoring are separate steps, and a candidate list depends on the chosen reference, PAM and mismatch limit.</p><p>The interface is inspired by the focused research workflow of <a href="https://rth.dk/resources/crispr/crisproff/" target="_blank" rel="noreferrer">CRISPRoff</a>. CRISPRoff uses its own energy-based scoring and specificity model; OfftargetPred does not reproduce those scores.</p></section>
      <section><h2>Software and documentation</h2><p><a href={repository} target="_blank" rel="noreferrer">Source code, deployment instructions and model documentation</a></p><p>The frontend is hosted on GitHub Pages; prediction jobs run on the project’s de.NBI backend. No model execution or genome search takes place on GitHub Pages.</p></section>
    </>}
  </div>
}

function ResultsPanel({ credentials, job, onDelete }: { credentials: Credentials; job: Job; onDelete: () => void }) {
  const [data, setData] = useState<Results | null>(null)
  const [offset, setOffset] = useState(0)
  const [query, setQuery] = useState('')
  const [search, setSearch] = useState('')
  const [sort, setSort] = useState(job.models.includes(1) ? 'k1' : `k${job.models[0]}`)
  const [order, setOrder] = useState('desc')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [downloading, setDownloading] = useState(false)
  const [linkCopied, setLinkCopied] = useState(false)
  const pageSize = 25
  useEffect(() => { const timer = window.setTimeout(() => { setSearch(query); setOffset(0) }, 300); return () => window.clearTimeout(timer) }, [query])
  useEffect(() => {
    let current = true
    setLoading(true); setError('')
    const params = new URLSearchParams({ offset: String(offset), limit: String(pageSize), q: search, sort, order })
    api<Results>(`/jobs/${encodeURIComponent(job.id)}/results?${params}`, {}, credentials.token)
      .then(result => { if (current) setData(result) })
      .catch(error => { if (current) { setError(message(error)); setData(null) } })
      .finally(() => { if (current) setLoading(false) })
    return () => { current = false }
  }, [credentials.token, job.id, offset, search, sort, order])
  const download = async (format: 'csv' | 'json') => {
    setDownloading(true); setError('')
    try { await downloadResult(credentials, format) } catch (error) { setError(message(error)) } finally { setDownloading(false) }
  }
  const copyLink = async () => {
    try {
      const url = new URL(window.location.pathname, window.location.origin)
      url.hash = new URLSearchParams({ job: credentials.id, token: credentials.token }).toString()
      await navigator.clipboard.writeText(url.toString())
      setLinkCopied(true)
      window.setTimeout(() => setLinkCopied(false), 4000)
    } catch { setError('The browser could not copy the private link. Download your results before closing this tab.') }
  }
  const mismatches = (row: ResultRow) => row.mismatches ?? row.target.slice(0, 20).split('').reduce((n, base, i) => n + Number(base !== row.off_target[i] && base !== 'N' && row.off_target[i] !== 'N'), 0)
  return <section className="results-panel" aria-labelledby="results-title">
    <div className="section-heading"><div><h2 id="results-title">Prediction results</h2><p>{(job.result_count ?? data?.total ?? 0).toLocaleString()} scored pairs{job.name ? ` for ${job.name}` : ''}</p></div><div className="download-actions"><button className="button secondary" onClick={() => download('csv')} disabled={downloading}><Arrow down /> Download CSV</button><button className="text-button" onClick={() => download('json')} disabled={downloading}>JSON & metadata</button></div></div>
    <div className="score-note"><strong>Higher score = stronger model support.</strong> Scores are not calibrated cleavage probabilities. Read <a href="#help">how to interpret results</a>.</div>
    <div className="result-controls"><label className="search-label">Filter candidates<input type="search" placeholder="Guide, ID, sequence or chromosome" value={query} onChange={event => setQuery(event.target.value)} /></label><label>Sort by<select value={sort} onChange={event => { setSort(event.target.value); setOffset(0) }}><option value="input">Input order</option>{job.models.map(model => <option key={model} value={`k${model}`}>k={model} score</option>)}<option value="mismatches">Mismatches</option></select></label><label>Order<select value={order} onChange={event => { setOrder(event.target.value); setOffset(0) }}><option value="desc">Descending</option><option value="asc">Ascending</option></select></label></div>
    {error && <div className="notice error" role="alert">{error}</div>}
    <div className={`table-scroll results-table-wrap ${loading ? 'is-loading' : ''}`} tabIndex={0} role="region" aria-label="Prediction results table" aria-busy={loading}>
      <table className="results-table"><caption className="sr-only">Candidate scores by CRISPert model. PAM bases are separated after position twenty; highlighted bases differ from the guide.</caption><thead><tr><th>Candidate</th><th>Aligned sequences <span>5′ to 3′</span></th><th title="Substitutions in the 20-base protospacer; PAM excluded">Mismatches</th>{job.models.map(model => <th key={model}>k={model} score</th>)}{job.mode === 'genome' && <th>Reference location</th>}</tr></thead><tbody>
        {data?.rows.map((row, index) => <tr key={`${row.id}-${index}`}><td><span className="row-id">{row.id}</span>{row.guide_id && <small>{row.guide_id}</small>}</td><td><div className="alignment-row"><span className="sequence-label">Guide</span><Sequence sequence={row.target} /></div><div className="alignment-row"><span className="sequence-label">Site</span><Sequence sequence={row.off_target} guide={row.target} /></div></td><td><span className="mismatch-count">{mismatches(row)}</span>{mismatches(row) === 0 && !/[Nn]/.test(row.target.slice(0, 20) + row.off_target.slice(0, 20)) && <small className="match-note">Exact protospacer</small>}{/[Nn]/.test(row.target + row.off_target) && <small>Contains N</small>}</td>{job.models.map(model => <td key={model}><span className="score-value">{row.scores[`k${model}`]?.toFixed(4) ?? '—'}</span><span className="score-track" aria-hidden="true"><span style={{ width: `${(row.scores[`k${model}`] ?? 0) * 100}%` }} /></span></td>)}{job.mode === 'genome' && <td className="coordinate">{row.chromosome ? <>{row.chromosome}:{row.start ?? row.position}–{row.end ?? (row.position !== undefined ? row.position + 23 : "")}<small>Strand {row.strand}; 0-based, end excluded</small></> : '—'}</td>}</tr>)}
        {!loading && !data?.rows.length && <tr><td colSpan={3 + job.models.length + Number(job.mode === 'genome')} className="empty-row">{search ? 'No candidates match this filter. Try another ID or sequence.' : 'No candidate sites were returned for this job.'}</td></tr>}
      </tbody></table>
    </div>
    <div className="pagination"><p aria-live="polite">{loading ? 'Loading results…' : data && data.total ? `${offset + 1}–${Math.min(offset + pageSize, data.total)} of ${data.total.toLocaleString()}${search ? ' matching' : ''} candidates` : '0 candidates'}</p><div><button className="button secondary compact" disabled={loading || offset === 0} onClick={() => setOffset(Math.max(0, offset - pageSize))}>Previous</button><button className="button secondary compact" disabled={loading || !data || offset + pageSize >= data.total} onClick={() => setOffset(offset + pageSize)}>Next</button></div></div>
    <div className="private-link-row"><button className="text-button" onClick={copyLink}>{linkCopied ? "Private link copied" : "Copy private result link"}</button><span>Anyone with the link can view this job until it expires.</span></div>
    <div className="job-footer"><p>Created {date(job.created_at)}{job.expires_at && <>. Expires {date(job.expires_at)}</>}. Downloads contain the full results.</p><button className="text-button danger" onClick={onDelete}>Delete job and data</button></div>
  </section>
}

export default function App() {
  const [page, setPage] = useState<'predict' | 'help' | 'about'>(() => window.location.hash === '#help' ? 'help' : window.location.hash === '#about' ? 'about' : 'predict')
  const [capabilities, setCapabilities] = useState<Capabilities | null>(null)
  const [connection, setConnection] = useState<'connecting' | 'connected' | 'unavailable'>('connecting')
  const [connectionError, setConnectionError] = useState('')
  const [mode, setMode] = useState<Mode>('pairs')
  const [inputMode, setInputMode] = useState<'single' | 'table'>('single')
  const [guide, setGuide] = useState('')
  const [candidates, setCandidates] = useState('')
  const [table, setTable] = useState('')
  const [genome, setGenome] = useState('')
  const [assembly, setAssembly] = useState('GRCh38')
  const [maxMismatches, setMaxMismatches] = useState(3)
  const [models, setModels] = useState<ModelId[]>([1])
  const [name, setName] = useState('')
  const [attempted, setAttempted] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [fileName, setFileName] = useState('')
  const [credentials, setCredentials] = useState<Credentials | null>(restoreJob)
  const [job, setJob] = useState<Job | null>(null)
  const [jobError, setJobError] = useState('')
  const [pollVersion, setPollVersion] = useState(0)
  const [busyJob, setBusyJob] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const errorRef = useRef<HTMLDivElement>(null)
  const jobRef = useRef<HTMLDivElement>(null)
  const validation = useMemo(() => validateInput(mode, inputMode, guide, candidates, table, genome, capabilities), [mode, inputMode, guide, candidates, table, genome, capabilities])
  const hasInput = mode === 'genome' ? Boolean(genome.trim()) : inputMode === 'single' ? Boolean(guide.trim() || candidates.trim()) : Boolean(table.trim())
  const running = Boolean(job && !terminal(job.status))
  const available = Boolean(capabilities?.modes.includes(mode))

  const connect = useCallback(async () => {
    setConnection('connecting'); setConnectionError('')
    try {
      const data = await api<Capabilities>('/capabilities')
      setCapabilities(data); setConnection('connected')
      if (data.genomes.length) setAssembly(data.genomes[0].id)
    } catch (error) { setConnection('unavailable'); setConnectionError(message(error)) }
  }, [])
  useEffect(() => { void connect() }, [connect])
  useEffect(() => {
    const onHash = () => { setPage(window.location.hash === '#help' ? 'help' : window.location.hash === '#about' ? 'about' : 'predict'); window.scrollTo({ top: 0 }) }
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])
  useEffect(() => {
    if (!credentials) return
    let current = true, timer = 0
    const poll = async () => {
      try {
        const result = await api<Job>(`/jobs/${encodeURIComponent(credentials.id)}`, {}, credentials.token)
        if (!current) return
        setJob(result); setJobError('')
        if (!terminal(result.status)) timer = window.setTimeout(poll, 2500)
      } catch (error) { if (current) setJobError(message(error)) }
    }
    void poll()
    return () => { current = false; window.clearTimeout(timer) }
  }, [credentials, pollVersion])
  useEffect(() => { if (attempted && (validation.errors.length || !models.length)) errorRef.current?.focus() }, [attempted, validation.errors.length, models.length])

  const readFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return
    setError('')
    if (file.size > (capabilities?.limits.request_bytes ?? 5242880)) { setError('This file exceeds the server’s request limit. Split it into smaller files.'); return }
    try { const text = await file.text(); setTable(text); setInputMode('table'); setFileName(file.name); setAttempted(true) } catch { setError('The file could not be read. Try pasting its contents into the table field.') }
    event.target.value = ''
  }
  const loadExample = () => {
    if (mode === 'genome') setGenome(exampleFasta)
    else if (inputMode === 'single') { setGuide(exampleGuide); setCandidates(exampleSites) }
    else setTable(exampleTable)
    setAttempted(false); setError(''); setFileName('')
  }
  const submit = async (event: FormEvent) => {
    event.preventDefault(); setAttempted(true); setError('')
    if (validation.errors.length || !models.length || !capabilities || !available || submitting || running) return
    const payload: Submission = { mode, input: validation.normalized, format: validation.format, models, name: name.trim(), ...(mode === 'genome' ? { assembly, max_mismatches: maxMismatches } : {}) }
    const body = JSON.stringify(payload)
    if (new TextEncoder().encode(body).length > capabilities.limits.request_bytes) { setError('The request exceeds the server’s input-size limit. Split the input into smaller jobs.'); return }
    setSubmitting(true)
    try {
      const created = await api<Credentials & { status: Job['status'] }>('/jobs', { method: 'POST', body })
      rememberJob({ id: created.id, token: created.token }); setCredentials({ id: created.id, token: created.token })
      setJob({ id: created.id, status: created.status, mode, models, name: payload.name, created_at: new Date().toISOString() }); setJobError('')
      window.setTimeout(() => jobRef.current?.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' }), 100)
    } catch (error) { setError(message(error)) } finally { setSubmitting(false) }
  }
  const cancelJob = async () => {
    if (!credentials) return
    setBusyJob(true)
    try { await api(`/jobs/${encodeURIComponent(credentials.id)}/cancel`, { method: 'POST' }, credentials.token); setPollVersion(value => value + 1) } catch (error) { setJobError(message(error)) } finally { setBusyJob(false) }
  }
  const deleteJob = async () => {
    if (!credentials || !window.confirm('Delete this job, its submitted sequences and its results from the server? Download any results you need first.')) return
    setBusyJob(true)
    try { await api(`/jobs/${encodeURIComponent(credentials.id)}`, { method: 'DELETE' }, credentials.token); rememberJob(null); setCredentials(null); setJob(null); setJobError('') } catch (error) { setJobError(message(error)) } finally { setBusyJob(false) }
  }
  const toggleModel = (model: ModelId) => setModels(values => values.includes(model) ? values.filter(value => value !== model) : [...values, model].sort() as ModelId[])
  const progress = typeof job?.progress === 'string' ? job.progress : job?.progress?.message || job?.progress?.stage

  return <><a className="skip-link" href="#main">Skip to content</a><header className="site-header"><div className="header-inner"><a className="brand" href="#predict" aria-label="OfftargetPred home"><Mark /><span>Offtarget<span className="brand-accent">Pred</span></span></a><nav aria-label="Main navigation"><a href="#predict" aria-current={page === 'predict' ? 'page' : undefined}>Predict</a><a href="#help" aria-current={page === 'help' ? 'page' : undefined}>Help</a><a href="#about" aria-current={page === 'about' ? 'page' : undefined}>About</a><a className="source-link" href={repository} target="_blank" rel="noreferrer">Source code <span aria-hidden="true">↗</span></a></nav></div></header>
    <main id="main" className="main-shell">
      {page !== 'predict' ? <Documentation page={page} capabilities={capabilities} /> : <>
        <header className="page-intro predict-intro"><div><h1>Assess CRISPR<br className="desktop-break" /> off-target sites.</h1><p>Score CRISPR candidate sites with three sequence-only CRISPert models, or search a reference genome for candidates.</p></div><div className={`connection-status ${connection}`} role="status"><span className="status-dot" /><span>{connection === 'connected' ? 'Prediction server connected' : connection === 'connecting' ? 'Connecting to prediction server' : 'Prediction server unavailable'}</span>{connection === 'unavailable' && <button className="text-button" onClick={connect}>Retry</button>}</div></header>
        {connection === 'unavailable' && <div className="notice error connection-notice"><p>{connectionError}</p><p>You can prepare your input and read the documentation while the server is unavailable.</p></div>}
        <div className="workbench"><section className="input-panel" aria-labelledby="new-prediction"><div className="panel-title"><h2 id="new-prediction">New prediction</h2><span className="subtle-label">Sequence only</span></div>
          <div className="mode-tabs" role="group" aria-label="Prediction mode"><button type="button" className={mode === 'pairs' ? 'active' : ''} aria-pressed={mode === 'pairs'} onClick={() => { setMode('pairs'); setAttempted(false); setError('') }}><span>Candidate pairs</span><small>I have candidate sites</small></button><button type="button" className={mode === 'genome' ? 'active' : ''} aria-pressed={mode === 'genome'} onClick={() => { setMode('genome'); setAttempted(false); setError('') }}><span>Genome search</span><small>Find sites for my guides</small></button></div>
          <form onSubmit={submit} noValidate>
            {mode === 'pairs' ? <div className="form-section"><div className="input-method-row"><fieldset className="inline-radio"><legend className="sr-only">Candidate input format</legend><label><input type="radio" name="input-method" checked={inputMode === 'single'} onChange={() => { setInputMode('single'); setAttempted(false) }} /> One guide</label><label><input type="radio" name="input-method" checked={inputMode === 'table'} onChange={() => { setInputMode('table'); setAttempted(false) }} /> CSV / TSV table</label></fieldset><button type="button" className="text-button" onClick={loadExample}>Load example</button></div>
              {inputMode === 'single' ? <><label className="field-label" htmlFor="guide">Guide sequence <span>with PAM</span></label><input id="guide" className="sequence-input" value={guide} placeholder="GATGCTCTCCAGAATCACTGCGG" spellCheck={false} autoComplete="off" onChange={event => setGuide(event.target.value)} aria-describedby="guide-hint" /><p id="guide-hint" className="field-hint">23 DNA bases, 5′ to 3′. Include the 3-base PAM at the end.</p><label className="field-label" htmlFor="candidates">Candidate off-target sites</label><textarea id="candidates" className="sequence-input" rows={5} value={candidates} placeholder={'One 23-base sequence per line\nGTTGCTCTTCAGAATCACTGAGG\nGCTGCCCTCCAGGATCACTGGGG'} spellCheck={false} onChange={event => setCandidates(event.target.value)} aria-describedby="candidates-hint" /><p id="candidates-hint" className="field-hint">Aligned with the guide. A, C, G, T and N are accepted; gaps and bulges are not.</p></> : <><div className="field-heading"><label className="field-label" htmlFor="pair-table">Sequence pair table</label><button className="text-button upload-button" type="button" onClick={() => fileRef.current?.click()}><Arrow down /> Upload file</button></div><input ref={fileRef} className="sr-only" type="file" accept=".csv,.tsv,text/csv,text/tab-separated-values" onChange={readFile} tabIndex={-1} aria-label="Upload CSV or TSV" /><textarea id="pair-table" className="sequence-input table-input" rows={8} value={table} placeholder={'ID,target,off_target\nsite-1,GATGCTCTCCAGAATCACTGCGG,GTTGCTCTTCAGAATCACTGAGG'} spellCheck={false} onChange={event => { setTable(event.target.value); setFileName('') }} aria-describedby="table-hint" /><p id="table-hint" className="field-hint">Required columns: <code>target</code> and <code>off_target</code>. <a href="#help">See accepted aliases</a>.{fileName && <span className="file-name">Loaded: {fileName}</span>}</p></>}
            </div> : <div className="form-section">{capabilities && !available && <div className="notice warning"><strong>Genome search is not currently available.</strong><p>The server has no ready reference index. You can still score existing candidate pairs.</p></div>}<div className="genome-settings"><label>Reference assembly<select value={assembly} onChange={event => setAssembly(event.target.value)} disabled={!available}>{capabilities?.genomes.length ? capabilities.genomes.map(item => <option key={item.id} value={item.id}>{item.label}</option>) : <option value="GRCh38">Human GRCh38</option>}</select></label><label>Maximum mismatches<select value={maxMismatches} onChange={event => setMaxMismatches(Number(event.target.value))}>{[0, 1, 2, 3, 4].map(n => <option key={n} value={n}>{n}</option>)}</select></label></div><div className="field-heading"><label className="field-label" htmlFor="genome-guides">Guide sequences <span>with PAM</span></label><button type="button" className="text-button" onClick={loadExample}>Load example</button></div><textarea id="genome-guides" className="sequence-input" rows={6} value={genome} placeholder={'>guide-name\nGATGCTCTCCAGAATCACTGCGG'} spellCheck={false} onChange={event => setGenome(event.target.value)} aria-describedby="genome-hint" /><p id="genome-hint" className="field-hint">One 23-base guide per line, or FASTA. Up to {capabilities?.limits.guides ?? 10} guides. Unambiguous DNA with an NGG PAM.</p><p className="search-scope"><strong>Search scope:</strong> NGG PAMs, both strands, up to four protospacer mismatches, no bulges. Candidates are scored with the models below.</p></div>}
            <fieldset className="model-fieldset"><legend>Choose models</legend><p>Compare each model independently. k=1 is the recommended starting point.</p><div className="model-options">{([1, 2, 3] as ModelId[]).map(model => <label key={model} className={`model-option ${models.includes(model) ? 'selected' : ''}`}><input type="checkbox" checked={models.includes(model)} onChange={() => toggleModel(model)} /><span><strong>k={model}</strong><small>{model === 1 ? 'Single-position tokens' : `${model}-position tokens`}</small></span>{model === 1 && <span className="default-label">Default</span>}</label>)}</div></fieldset>
            <div className="job-name-field"><label className="field-label" htmlFor="job-name">Job name <span>optional</span></label><input id="job-name" value={name} maxLength={80} placeholder="A label for this analysis" onChange={event => setName(event.target.value)} /></div>
            {attempted && (validation.errors.length > 0 || !models.length) && <div className="notice error validation-errors" role="alert" tabIndex={-1} ref={errorRef}><strong>Check your input</strong><ul>{!models.length && <li>Select at least one model.</li>}{validation.errors.slice(0, 5).map((error, i) => <li key={i}>{error}</li>)}{validation.errors.length > 5 && <li>And {validation.errors.length - 5} more input errors. Correct the table before submitting.</li>}</ul></div>}
            {hasInput && validation.warnings.map(warning => <div className="notice warning" key={warning}>{warning}</div>)}
            {error && <div className="notice error" role="alert">{error}</div>}
            <div className="submit-area"><div className="input-summary" aria-live="polite">{hasInput && !validation.errors.length ? <><span className="valid-dot" /> {validation.rows.toLocaleString()} {mode === 'pairs' ? 'pairs' : 'guides'} ready{mode === 'pairs' && <> across {validation.guideCount} {validation.guideCount === 1 ? 'guide' : 'guides'}</>}</> : <>Your input stays in this form until submitted.</>}</div><button className="button primary submit-button" type="submit" disabled={submitting || running || !available}>{submitting ? 'Submitting…' : running ? 'A job is running' : mode === 'genome' ? 'Find and score candidates' : 'Score candidates'}<Arrow /></button><p className="privacy-note">{capabilities ? `Submitted sequences and results are kept for ${capabilities.retention_hours} hours. You can delete them sooner.` : 'Connect to the prediction server to submit your sequences.'} No email required.</p></div>
          </form>
        </section><aside className="guide-panel" aria-label="Input guidance"><h2>Read the mismatch pattern.</h2><p>The models read a guide and candidate site together, learning from the pattern of matches and mismatches.</p><AlignmentExample /><div className="guide-note"><h3>Bring sites. Compare models.</h3><p>Candidate mode scores the sites you provide. It does not search a genome or measure the overall specificity of a guide.</p></div><div className="guide-note"><h3>Three views of the same sequence</h3><p>k=1, k=2 and k=3 read increasingly wider groups of aligned positions. Their scores stay separate so you can compare them directly.</p><a href="#about">Read about the models <span aria-hidden="true">↗</span></a></div><div className="quick-facts"><div><span>Input length</span><strong>23 bases, including PAM</strong></div><div><span>Scoring features</span><strong>DNA sequence only</strong></div><div><span>Score range</span><strong>0–1, uncalibrated</strong></div>{capabilities && <div><span>Pair limit</span><strong>{capabilities.limits.pairs.toLocaleString()} per job</strong></div>}</div><a className="help-link" href="#help">Input format and interpretation guide</a></aside></div>
        {credentials && <div ref={jobRef} className="job-section" aria-live="polite">{jobError && <div className="notice error"><p>{jobError}</p><div className="inline-actions"><button className="text-button" onClick={() => setPollVersion(value => value + 1)}>Retry job status</button><button className="text-button" onClick={() => { rememberJob(null); setCredentials(null); setJob(null); setJobError('') }}>Forget saved access in this tab</button></div></div>}{job && !successful(job.status) && <section className="job-status-panel"><div className="section-heading"><div><div className="status-label"><span className={`status-dot ${running ? 'busy' : ''}`} />{job.status === 'queued' ? 'Queued for prediction' : job.status === 'running' ? 'Analysis in progress' : job.status === 'failed' ? 'Job could not finish' : job.status === 'cancelling' ? 'Cancelling job' : 'Job cancelled'}</div><h2>{job.name || (job.mode === 'genome' ? 'Genome candidate search' : 'Candidate scoring')}</h2></div>{running && <button className="button secondary compact" onClick={cancelJob} disabled={busyJob}>Cancel job</button>}</div>{running && <div className="activity-line" aria-hidden="true" />}<p>{typeof job.error === 'string' ? job.error : job.error?.message || job.error?.detail || progress || (job.status === 'queued' ? 'Your sequences are waiting for an available worker. This page updates automatically.' : job.status === 'running' ? 'The server is processing your input. This page updates automatically.' : 'Your input is still in the form above. Review it before starting a new job.')}</p>{job.warnings?.map(warning => <p className="notice warning" key={warning}>{warning}</p>)}<p className="job-identification">Job {job.id}. Created {date(job.created_at)}</p>{!running && <button className="text-button danger" onClick={deleteJob} disabled={busyJob}>Delete job and data</button>}</section>}{job && successful(job.status) && <ResultsPanel key={job.id} credentials={credentials} job={job} onDelete={deleteJob} />}</div>}
      </>}
    </main><footer className="site-footer"><div><span className="footer-brand">OfftargetPred</span><span>Sequence-only predictions with CRISPert</span></div><div><a href="#help">Documentation</a><a href={repository} target="_blank" rel="noreferrer">GitHub</a><span title={apiOrigin || 'Same-origin development API'}>de.NBI compute</span></div></footer>
  </>
}
