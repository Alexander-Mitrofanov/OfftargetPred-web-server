import { useId, useMemo, useState } from "react";
import type { ResultRow } from "../api";
import {
  buildContext, CONTEXT_DRAW_LIMIT, CONTEXT_FLANKS, contextCandidateLabel, contextFraction,
  featureLabel, findContextCandidates, indexContextRows,
} from "../features/genomeContext";
import type { ContextSnapshot } from "../features/genomeContext";
import "./GenomeContext.css";

const tablePageSize = 20;
function RegionPicture({ context }: { context: ContextSnapshot }) {
  const id = useId();
  const left = 180, plotWidth = 700, top = 64, lineHeight = 24;
  const annotationY = top + context.drawnSites.length * lineHeight + 48;
  const height = annotationY + context.drawnFeatures.length * lineHeight + 34;
  const x = (position: number) => left + contextFraction(position, context.window) * plotWidth;
  const bar = (start: number, end: number, strand: string, y: number, className: string, title: string) => {
    const startX = x(start), width = Math.max(2, x(end) - startX), arrowX = strand === "+" ? startX + width : startX;
    return <g className={className}><title>{title}</title><rect x={startX} y={y - 6} width={width} height={12} />
      <path d={strand === "+" ? `M${arrowX - 4},${y - 4} L${arrowX},${y} L${arrowX - 4},${y + 4}` : `M${arrowX + 4},${y - 4} L${arrowX},${y} L${arrowX + 4},${y + 4}`} />
      {start < context.window.start && <text x={left - 8} y={y + 4} textAnchor="end">‹</text>}
      {end > context.window.end && <text x={left + plotWidth + 8} y={y + 4}>›</text>}
    </g>;
  };
  return <figure className="genome-context-figure">
    <div className="genome-context-picture" tabIndex={0} role="region" aria-label="Genomic context diagram; scroll horizontally on narrow screens">
      <svg viewBox={`0 0 960 ${height}`} role="img" aria-labelledby={`${id}-title ${id}-description`}>
        <title id={`${id}-title`}>Candidate-centered GRCh38 genomic context</title>
        <desc id={`${id}-description`}>Forward-reference coordinates increase left to right. Arrowheads indicate strand. Blue candidate bars include the full 23-nucleotide site and PAM. Teal features are annotations overlapping the focal candidate only. Tables below give every available record and exact coordinates.</desc>
        <line className="genome-context-axis" x1={left} x2={left + plotWidth} y1={27} y2={27} />
        {[0, .5, 1].map(fraction => <g key={fraction}>
          <line className="genome-context-axis" x1={left + fraction * plotWidth} x2={left + fraction * plotWidth} y1={23} y2={31} />
          <text x={left + fraction * plotWidth} y={18} textAnchor={fraction === 0 ? "start" : fraction === 1 ? "end" : "middle"}>{Math.round(context.window.start + 1 + fraction * (context.window.end - context.window.start - 1)).toLocaleString()}</text>
        </g>)}
        <text x={12} y={46} className="genome-context-track-label">Candidate sites</text>
        {context.drawnSites.map((site, i) => {
          const y = top + i * lineHeight, focal = site.candidates.some(candidate => candidate.index === context.focal.index);
          const label = `Row ${site.candidates[0].index + 1}${site.candidates.length > 1 ? ` +${site.candidates.length - 1}` : ""}${focal ? " · focus" : ""}`;
          return <g key={site.key}><text x={12} y={y + 4}>{label} ({site.locus.strand})</text>
            {bar(site.locus.start, site.locus.end, site.locus.strand, y, `genome-context-site${focal ? " genome-context-focal" : ""}`, `${label}: ${site.locus.start + 1}–${site.locus.end}; ${site.candidates.length} result row(s)`)}</g>;
        })}
        <text x={12} y={annotationY - 20} className="genome-context-track-label">Focal-site overlaps only</text>
        {context.drawnFeatures.map(({ key, feature }, i) => {
          const y = annotationY + i * lineHeight, label = `${feature.gene_name || feature.gene_id} · ${feature.feature}`;
          return <g key={key}><text x={12} y={y + 4}>{label.length > 24 ? `${label.slice(0, 22)}…` : label}<title>{label}</title></text>
            {bar(feature.start, feature.end, feature.strand, y, `genome-context-feature${feature.feature === "intron" ? " genome-context-intron" : ""}`, `${label}: ${feature.start + 1}–${feature.end}; ${feature.strand} strand${feature.transcript_id ? `; ${feature.transcript_id}` : ""}`)}</g>;
        })}
        {!context.drawnFeatures.length && <text x={left} y={annotationY + 4}>No drawable focal-site features</text>}
      </svg>
    </div>
    <figcaption>Arrows show strand; brackets at plot edges mark clipped features. Narrow sites have a minimum display width of 2 pixels. Exact spans are in the tables.</figcaption>
  </figure>;
}

function Pager({ count, page, setPage, label }: { count: number; page: number; setPage: (page: number) => void; label: string }) {
  if (count <= tablePageSize) return null;
  return <div className="genome-context-pager"><span>{page * tablePageSize + 1}–{Math.min(count, (page + 1) * tablePageSize)} of {count.toLocaleString()}</span>
    <button type="button" className="button secondary compact" aria-label={`Previous ${label}`} disabled={page === 0} onClick={() => setPage(page - 1)}>Previous</button>
    <button type="button" className="button secondary compact" aria-label={`Next ${label}`} disabled={(page + 1) * tablePageSize >= count} onClick={() => setPage(page + 1)}>Next</button>
  </div>;
}

function ContextBody({ rows, selectedRows = [] }: { rows: ResultRow[]; selectedRows?: ResultRow[] }) {
  const id = useId();
  const index = useMemo(() => indexContextRows(rows), [rows]);
  const [selectedOnly, setSelectedOnly] = useState(selectedRows.length > 0);
  const [query, setQuery] = useState("");
  const selectedSet = useMemo(() => new Set(selectedRows), [selectedRows]);
  const initialFocus = index.located.find(candidate => selectedSet.has(candidate.row)) ?? index.located[0];
  const [focusIndex, setFocusIndex] = useState(initialFocus?.index ?? -1);
  const [flank, setFlank] = useState(1_000);
  const [candidatePage, setCandidatePage] = useState(0), [featurePage, setFeaturePage] = useState(0);
  const choices = useMemo(() => findContextCandidates(index, query, selectedOnly ? selectedRows : undefined), [index, query, selectedOnly, selectedRows]);
  const context = useMemo(() => buildContext(index, focusIndex, flank), [index, focusIndex, flank]);
  const choose = (value: number) => { setFocusIndex(value); setCandidatePage(0); setFeaturePage(0); };
  const menu = choices.slice(0, 100);
  const addFocal = context && !menu.some(candidate => candidate.index === focusIndex);
  return <section aria-label="Embedded genomic context">
    <p>Inspect a candidate and nearby sites from this result set. This view stays in your browser and makes no external requests.</p>
    {!index.located.length ? <p className="genome-context-notice">{rows.length ? "No candidates have a supported, explicit GRCh38 interval and strand. Coordinates are not inferred from sequence-only pairs." : "This analysis has no candidate sites to display."}</p> : <>
      <div className="genome-context-controls">
        <label htmlFor={`${id}-search`}>Find a focal candidate<input id={`${id}-search`} type="search" value={query} placeholder="Row number, candidate ID, guide or chromosome" onChange={event => setQuery(event.target.value)} /></label>
        <label htmlFor={`${id}-flank`}><span id={`${id}-flank-label`}>Flank on each side</span><select id={`${id}-flank`} aria-labelledby={`${id}-flank-label`} value={flank} onChange={event => { setFlank(Number(event.target.value)); setCandidatePage(0); setFeaturePage(0); }}>{CONTEXT_FLANKS.map(value => <option key={value} value={value}>{value.toLocaleString()} bp</option>)}</select></label>
      </div>
      <label className="genome-context-check"><input type="checkbox" checked={selectedOnly} onChange={event => setSelectedOnly(event.target.checked)} />Choose from selected candidates only ({selectedRows.length.toLocaleString()})</label>
      <label className="genome-context-chooser" htmlFor={`${id}-candidate`}><span id={`${id}-candidate-label`}>Focal candidate</span><select id={`${id}-candidate`} aria-labelledby={`${id}-candidate-label`} value={context ? focusIndex : ""} onChange={event => choose(Number(event.target.value))}>
        {addFocal && <option value={focusIndex}>{contextCandidateLabel(context.focal)} · current focus</option>}
        {!context && <option value="">Choose a candidate</option>}
        {menu.map(candidate => <option key={candidate.index} value={candidate.index}>{contextCandidateLabel(candidate)}</option>)}
      </select></label>
      <p className="genome-context-hint" role="status">{choices.length.toLocaleString()} matching candidates. {choices.length > 100 ? "The first 100 are offered; narrow the search to find others." : ""}{!choices.length ? " Change the search or selection filter; your current focus remains visible." : ""}</p>
      {context && <>
        <h3>GRCh38 {context.window.chromosome}:{(context.window.start + 1).toLocaleString()}–{context.window.end.toLocaleString()}</h3>
        <p className="genome-context-scope">Display coordinates are <strong>1-based, inclusive</strong>; stored intervals are <strong>0-based, half-open</strong>. The focal site is [{context.focal.locus.start.toLocaleString()}, {context.focal.locus.end.toLocaleString()}) on the {context.focal.locus.strand} strand. All intervals use the forward reference; sequence orientation follows each site's strand.</p>
        {context.focal.row.coordinate_verification && <p className="genome-context-hint">Focal coordinates: {context.focal.row.coordinate_verification}.</p>}
        <p className="genome-context-hint">This viewer checks coordinate bounds and conventions. It does not check whether an imported candidate sequence matches the reference; annotations on imported coordinates describe positional overlaps only.</p>
        <RegionPicture context={context} />
        <p>{context.nearby.length.toLocaleString()} result rows occupy {context.sites.length.toLocaleString()} distinct interval/strand sites in this window. {context.sites.length > CONTEXT_DRAW_LIMIT ? `The diagram shows the ${CONTEXT_DRAW_LIMIT} nearest sites; every row is available in the paginated table.` : "Rows at the same interval and strand share one bar."} Other genomic sites were not queried by this viewer.</p>
        <details className="genome-context-table-details"><summary>Nearby candidate table ({context.nearby.length.toLocaleString()} rows)</summary>
          <div className="genome-context-table" tabIndex={0} role="region" aria-label="Nearby candidates, scroll for all columns"><table><caption>All returned candidates intersecting this window; duplicate result rows are retained. Intervals below are 1-based, inclusive.</caption><thead><tr><th scope="col">Input row / ID</th><th scope="col">Guide</th><th scope="col">Interval</th><th scope="col">Strand</th><th scope="col">Action</th></tr></thead><tbody>{context.nearby.slice(candidatePage * tablePageSize, (candidatePage + 1) * tablePageSize).map(candidate => <tr key={candidate.index}><td>{candidate.index + 1} / {candidate.row.id}{candidate.index === focusIndex && <small>Current focus</small>}</td><td>{candidate.row.guide_id || "Unlabelled"}</td><td>{candidate.locus.start + 1}–{candidate.locus.end}</td><td>{candidate.locus.strand}</td><td><button className="text-button" type="button" onClick={() => choose(candidate.index)} disabled={candidate.index === focusIndex} aria-label={`Focus candidate row ${candidate.index + 1}`}>Focus</button></td></tr>)}</tbody></table></div>
          <Pager count={context.nearby.length} page={candidatePage} setPage={setCandidatePage} label="nearby candidates" />
        </details>
        <h4>Annotations overlapping the focal site</h4>
        <p className="genome-context-scope">These are sparse site-overlap annotations, <strong>not a complete regional gene track</strong>. Features elsewhere in the displayed window are not loaded. Introns are inferred gaps between merged exons within each transcript; no missing exons or transcript structure are reconstructed here.</p>
        {context.annotationStatus !== "annotated" ? <p className="genome-context-notice">Annotation unavailable: {context.annotationReason}</p> : <>
          <p>{context.annotationSource}. {context.focal.row.annotations?.categories.includes("intergenic") ? "The focal site has no gene or transcript overlap in its recorded annotation release. This does not classify the surrounding window." : `${context.features.length.toLocaleString()} distinct overlapping features are available.`}</p>
          {context.annotationTruncated && <p className="genome-context-notice">The result marks its annotations as truncated; this is a partial feature list.</p>}
          {!!context.invalidFeatures && <p className="genome-context-notice">{context.invalidFeatures} feature record(s) could not be drawn because their coordinates or focal-site overlap are invalid.</p>}
          {context.features.length > CONTEXT_DRAW_LIMIT && <p>The diagram displays the first {CONTEXT_DRAW_LIMIT} features, ordered by feature type and position; the table includes all {context.features.length.toLocaleString()} distinct valid records.</p>}
          {!!context.features.length && <details className="genome-context-table-details"><summary>Focal-site feature table ({context.features.length.toLocaleString()} features)</summary>
            <div className="genome-context-table" tabIndex={0} role="region" aria-label="Focal-site annotation features, scroll for all columns"><table><caption>1-based, inclusive intervals. Repeated identical features are grouped with their record count.</caption><thead><tr><th scope="col">Gene / transcript</th><th scope="col">Feature</th><th scope="col">Interval</th><th scope="col">Strand</th><th scope="col">Records</th></tr></thead><tbody>{context.features.slice(featurePage * tablePageSize, (featurePage + 1) * tablePageSize).map(({ key, feature, copies }) => <tr key={key}><td>{feature.gene_name || feature.gene_id}<small>{feature.gene_id}</small><small>{feature.transcript_id || "No transcript ID"}</small></td><td>{featureLabel(feature)}</td><td>{feature.start + 1}–{feature.end}</td><td>{feature.strand}</td><td>{copies}</td></tr>)}</tbody></table></div>
            <Pager count={context.features.length} page={featurePage} setPage={setFeaturePage} label="annotation features" />
          </details>}
        </>}
        <p className="genome-context-hint">Genomic overlap does not establish functional harm and does not change any model score.</p>
      </>}
    </>}
    {!!index.skipped.length && <details className="genome-context-table-details"><summary>{index.skipped.length.toLocaleString()} result rows excluded from the coordinate view</summary><p>The full result table and exports retain these rows.</p><ul>{[...new Set(index.skipped.map(item => item.reason))].map(reason => <li key={reason}>{reason}</li>)}</ul></details>}
  </section>;
}

/** The body and full-row index are created only after the user expands it. */
export function GenomeContext({ rows, selectedRows }: { rows: ResultRow[]; selectedRows?: ResultRow[] }) {
  const [open, setOpen] = useState(false);
  return <details className="genome-context" onToggle={event => setOpen(event.currentTarget.open)}><summary>Explore genomic context</summary>{open && <ContextBody rows={rows} selectedRows={selectedRows} />}</details>;
}
