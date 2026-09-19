import { useId, useMemo, useState } from "react";
import type { Mode, ResultRow } from "../api";
import {
  annotationCategoryLabel,
  countRowsByGuide,
  createOverviewFilters,
  filterOverviewRows,
  overviewScope,
  summarizeOverview,
} from "../features/overview";
import type { OverviewFilters } from "../features/overview";
import "./GuideOverview.css";

export interface GuideOverviewProps {
  /** Complete downloaded analysis document, never a server page or filtered subset. */
  rows: ResultRow[];
  mode: Mode;
  metadata: Record<string, unknown>;
  filters: OverviewFilters;
  onChange: (filters: OverviewFilters) => void;
}

const pageSize = 25;
const guideOptionLimit = 200;
const integerOptions = Array.from({ length: 21 }, (_, index) => index);
const number = (value: number) => value.toLocaleString();

export function GuideOverview({
  rows,
  mode,
  metadata,
  filters,
  onChange,
}: GuideOverviewProps) {
  const id = useId();
  const [summaryOpen, setSummaryOpen] = useState(false);
  const [guideSearch, setGuideSearch] = useState("");
  const [page, setPage] = useState(0);
  const submittedGuides = mode === "genome" ? metadata.submitted_guides : undefined;
  const summary = useMemo(() => summarizeOverview(rows, submittedGuides), [rows, submittedGuides]);
  const visibleRows = useMemo(
    () => filterOverviewRows(rows, filters),
    [rows, filters],
  );
  const visibleByGuide = useMemo(
    () => countRowsByGuide(visibleRows),
    [visibleRows],
  );
  const matchingGuides = useMemo(() => {
    const query = guideSearch.trim().toLocaleLowerCase();
    return query
      ? summary.guides.filter((guide) =>
          guide.label.toLocaleLowerCase().includes(query),
        )
      : summary.guides;
  }, [summary.guides, guideSearch]);
  const guideOptions = useMemo(() => {
    const options = matchingGuides.slice(0, guideOptionLimit);
    const selected = summary.guides.find(
      (guide) => guide.key === filters.guideKey,
    );
    if (selected && !options.some((guide) => guide.key === selected.key))
      options.unshift(selected);
    return options;
  }, [matchingGuides, summary.guides, filters.guideKey]);
  const categories = useMemo(
    () =>
      [...summary.categories].sort(([left], [right]) =>
        left.localeCompare(right),
      ),
    [summary.categories],
  );
  const lastPage = Math.max(0, Math.ceil(summary.guides.length / pageSize) - 1);
  const currentPage = Math.min(page, lastPage);
  const pageGuides = summary.guides.slice(
    currentPage * pageSize,
    (currentPage + 1) * pageSize,
  );
  const scientificFilterCount =
    Number(Boolean(filters.annotation)) +
    Number(filters.minMismatches !== null || filters.maxMismatches !== null) +
    Number(!filters.includeUnknownMismatches) +
    Number(filters.exactMatch !== "all");
  const invalidRange =
    filters.minMismatches !== null &&
    filters.maxMismatches !== null &&
    filters.minMismatches > filters.maxMismatches;
  const change = (patch: Partial<OverviewFilters>) =>
    onChange({ ...filters, ...patch });

  return (
    <section className="guide-overview" aria-labelledby={`${id}-title`}>
      <div className="guide-overview-heading">
        <div>
          <h3 id={`${id}-title`}>Candidate overview</h3>
          <p className="guide-overview-scope">
            {overviewScope(mode, metadata)}
          </p>
        </div>
        <button
          type="button"
          className="guide-overview-reset"
          onClick={() => {
            setGuideSearch("");
            setPage(0);
            onChange(createOverviewFilters());
          }}
        >
          Reset filters
        </button>
      </div>

      <dl className="guide-overview-counts">
        <div>
          <dt>Candidate rows</dt>
          <dd>{number(summary.total)}</dd>
        </div>
        <div>
          <dt>{Array.isArray(submittedGuides) ? "Submitted guides" : "Guides represented"}</dt>
          <dd>{number(summary.guides.length)}</dd>
        </div>
        <div>
          <dt>With annotations</dt>
          <dd>{number(summary.annotated)}</dd>
        </div>
        <div>
          <dt>Unknown mismatches</dt>
          <dd>{number(summary.unknownMismatches)}</dd>
        </div>
      </dl>

      <div className="guide-overview-filters">
        <div className="guide-overview-guide-select">
          <label htmlFor={`${id}-guide`}>Guide</label>
          {summary.guides.length > guideOptionLimit && (
            <input
              type="search"
              value={guideSearch}
              onChange={(event) => setGuideSearch(event.target.value)}
              aria-label="Find a guide by ID or sequence"
              placeholder="Find guide ID or sequence"
            />
          )}
          <select
            id={`${id}-guide`}
            value={filters.guideKey}
            onChange={(event) => change({ guideKey: event.target.value })}
          >
            <option value="">
              All guides ({number(summary.guides.length)})
            </option>
            {guideOptions.map((guide) => (
              <option key={guide.key} value={guide.key}>
                {guide.label} ({number(guide.total)})
              </option>
            ))}
          </select>
          {matchingGuides.length > guideOptionLimit && (
            <small>
              First {guideOptionLimit} of {number(matchingGuides.length)} guides
              listed. Type an ID or sequence to narrow the choices.
            </small>
          )}
        </div>
        <label>
          Find candidates
          <input
            type="search"
            value={filters.query}
            onChange={(event) => change({ query: event.target.value })}
            placeholder="ID, sequence, chromosome or gene"
          />
        </label>
      </div>

      <details className="guide-overview-scientific">
        <summary>
          Scientific filters
          {scientificFilterCount > 0
            ? ` · ${scientificFilterCount} active`
            : ""}
        </summary>
        <div className="guide-overview-filters guide-overview-advanced">
          <label>
            Genomic annotation
            <select
              value={filters.annotation}
              onChange={(event) => change({ annotation: event.target.value })}
            >
              <option value="">All annotation states</option>
              <option value="status:annotated">
                Annotated ({number(summary.annotated)})
              </option>
              <option value="status:unavailable">
                Unavailable ({number(summary.unavailable)})
              </option>
              <option value="status:no_coordinates">
                No coordinates ({number(summary.noCoordinates)})
              </option>
              {categories.map(([category, count]) => (
                <option key={category} value={`category:${category}`}>
                  {annotationCategoryLabel(category)} ({number(count)})
                </option>
              ))}
            </select>
          </label>
          <label>
            Full-sequence exact matches
            <select
              value={filters.exactMatch}
              onChange={(event) =>
                change({
                  exactMatch: event.target
                    .value as OverviewFilters["exactMatch"],
                })
              }
            >
              <option value="all">Show all candidates</option>
              <option value="hide">Hide known exact matches</option>
              <option value="only">Only known exact matches</option>
            </select>
          </label>
          <fieldset className="guide-overview-range">
            <legend>Protospacer mismatches (20 bases)</legend>
            <div>
              <label>
                Minimum
                <select
                  value={filters.minMismatches ?? ""}
                  aria-invalid={invalidRange || undefined}
                  onChange={(event) =>
                    change({
                      minMismatches:
                        event.target.value === ""
                          ? null
                          : Number(event.target.value),
                    })
                  }
                >
                  <option value="">Any</option>
                  {integerOptions.map((value) => (
                    <option key={value} value={value}>
                      {value}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Maximum
                <select
                  value={filters.maxMismatches ?? ""}
                  aria-invalid={invalidRange || undefined}
                  onChange={(event) =>
                    change({
                      maxMismatches:
                        event.target.value === ""
                          ? null
                          : Number(event.target.value),
                    })
                  }
                >
                  <option value="">Any</option>
                  {integerOptions.map((value) => (
                    <option key={value} value={value}>
                      {value}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <label className="guide-overview-checkbox">
              <input
                type="checkbox"
                checked={filters.includeUnknownMismatches}
                onChange={(event) =>
                  change({ includeUnknownMismatches: event.target.checked })
                }
              />
              Include unknown mismatch counts
            </label>
            {invalidRange && (
              <p className="guide-overview-warning" role="alert">
                Minimum exceeds maximum. No known mismatch counts match this
                range.
              </p>
            )}
          </fieldset>
        </div>
        <p className="guide-overview-note">
          An N in the protospacer makes its mismatch count unknown. Exact
          matching compares all 23 unambiguous bases, including the PAM; it does
          not establish the intended on-target locus. Hiding known exact matches
          keeps rows with unknown identity.
        </p>
      </details>

      <p className="guide-overview-showing" role="status" aria-live="polite">
        Showing <strong>{number(visibleRows.length)}</strong> of{" "}
        {number(summary.total)} candidate rows
        {summary.total > 0 && visibleRows.length === 0
          ? ". No rows match these filters."
          : "."}
      </p>
      {summary.total === 0 && (
        <p className="guide-overview-note">
          No candidate rows were returned within this search scope.
          {!Array.isArray(submittedGuides) && " Guide inputs are absent from this older result document, so zero-hit guides cannot be counted."}
        </p>
      )}

      <details
        className="guide-overview-details"
        onToggle={(event) => setSummaryOpen(event.currentTarget.open)}
      >
        <summary>Per-guide counts and distributions</summary>
        {summaryOpen && (
          <div className="guide-overview-detail-body">
            <p className="guide-overview-note">
              Totals below always describe the full result document. Repeated
              candidate rows are counted separately. Category counts may
              overlap; unavailable annotations are not intergenic calls.
            </p>
            <div
              className="guide-overview-table-scroll"
              tabIndex={0}
              role="region"
              aria-label="Per-guide counts, scrollable table"
            >
              <table>
                <caption>
                  Guides are grouped by both supplied guide ID and sequence.
                </caption>
                <thead>
                  <tr>
                    <th scope="col">Guide ID / sequence</th>
                    <th scope="col">All rows</th>
                    <th scope="col">In view</th>
                    <th scope="col">Exact matches</th>
                    <th scope="col">Annotated</th>
                    <th scope="col">Unknown mismatches</th>
                  </tr>
                </thead>
                <tbody>
                  {pageGuides.map((guide) => (
                    <tr key={guide.key}>
                      <th scope="row">
                        <button
                          type="button"
                          className="guide-overview-guide-button"
                          aria-pressed={filters.guideKey === guide.key}
                          onClick={() =>
                            change({
                              guideKey:
                                filters.guideKey === guide.key ? "" : guide.key,
                            })
                          }
                        >
                          <span>{guide.id || "No guide ID supplied"}</span>
                          <code>{guide.sequence}</code>
                          <span className="guide-overview-guide-action">
                            {filters.guideKey === guide.key
                              ? "Clear guide filter"
                              : "Filter to this guide"}
                          </span>
                        </button>
                      </th>
                      <td>{number(guide.total)}</td>
                      <td>{number(visibleByGuide.get(guide.key) ?? 0)}</td>
                      <td>{number(guide.exactMatches)}</td>
                      <td>{number(guide.annotated)}</td>
                      <td>{number(guide.unknownMismatches)}</td>
                    </tr>
                  ))}
                  {pageGuides.length === 0 && (
                    <tr>
                      <td colSpan={6}>
                        No guides represented in returned rows.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            {lastPage > 0 && (
              <div className="guide-overview-pagination">
                <button
                  type="button"
                  disabled={currentPage === 0}
                  onClick={() => setPage(currentPage - 1)}
                >
                  Previous guides
                </button>
                <span>
                  Page {number(currentPage + 1)} of {number(lastPage + 1)}
                </span>
                <button
                  type="button"
                  disabled={currentPage === lastPage}
                  onClick={() => setPage(currentPage + 1)}
                >
                  Next guides
                </button>
              </div>
            )}
            <div className="guide-overview-distributions">
              <table>
                <caption>Protospacer mismatch distribution · all rows</caption>
                <thead>
                  <tr>
                    <th scope="col">Mismatches</th>
                    <th scope="col">Rows</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.mismatches.map(
                    (count, mismatch) =>
                      count > 0 && (
                        <tr key={mismatch}>
                          <th scope="row">{mismatch}</th>
                          <td>{number(count)}</td>
                        </tr>
                      ),
                  )}
                  <tr>
                    <th scope="row">Unknown</th>
                    <td>{number(summary.unknownMismatches)}</td>
                  </tr>
                </tbody>
              </table>
              <table>
                <caption>Annotation coverage · all rows</caption>
                <thead>
                  <tr>
                    <th scope="col">State / category</th>
                    <th scope="col">Rows</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <th scope="row">Annotated</th>
                    <td>{number(summary.annotated)}</td>
                  </tr>
                  {categories.map(([category, count]) => (
                    <tr key={category}>
                      <th className="guide-overview-category" scope="row">
                        {annotationCategoryLabel(category)}
                      </th>
                      <td>{number(count)}</td>
                    </tr>
                  ))}
                  <tr>
                    <th scope="row">Unavailable</th>
                    <td>{number(summary.unavailable)}</td>
                  </tr>
                  <tr>
                    <th scope="row">No coordinates</th>
                    <td>{number(summary.noCoordinates)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p className="guide-overview-note">
              Known full-sequence exact matches: {number(summary.exactMatches)}.
              Unknown full-sequence identity:{" "}
              {number(summary.unknownExactMatches)}. These descriptive counts do
              not estimate cleavage probability or guide safety.
            </p>
          </div>
        )}
      </details>
    </section>
  );
}
