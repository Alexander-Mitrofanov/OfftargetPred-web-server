import { useId, useMemo, useState } from "react";
import {
  guessColumns,
  inspectTable,
  mapColumns,
} from "../features/columnMapping";
import type {
  ColumnSelection,
  TableDelimiter,
} from "../features/columnMapping";
import "./ColumnMapper.css";

export interface ColumnMapperProps {
  rawText: string;
  onApplyTable: (normalizedCsv: string) => void;
  maxRows?: number;
  maxRequestBytes?: number;
}

/** This helper only edits the input table. Applying a mapping never submits a job. */
export function ColumnMapper({
  rawText,
  onApplyTable,
  maxRows = 10_000,
  maxRequestBytes = 5 * 1024 * 1024,
}: ColumnMapperProps) {
  const id = useId();
  const [delimiter, setDelimiter] = useState<TableDelimiter>("auto");
  const [choice, setChoice] = useState<{
    source: string;
    delimiter: TableDelimiter;
    columns: ColumnSelection;
    checked: boolean;
  } | null>(null);
  const table = useMemo(
    () => inspectTable(rawText, { maxRows, maxRequestBytes }, delimiter),
    [rawText, maxRows, maxRequestBytes, delimiter],
  );
  const guesses = useMemo(() => guessColumns(table.headers), [table.headers]);
  const current =
    choice?.source === rawText && choice.delimiter === delimiter
      ? choice
      : null;
  const columns = current?.columns ?? guesses;
  const mapped = useMemo(
    () => mapColumns(table, columns, { maxRows, maxRequestBytes }),
    [table, columns, maxRows, maxRequestBytes],
  );
  const canApply = mapped.valid && current?.checked === true;
  function select(field: keyof ColumnSelection, value: string) {
    setChoice({
      source: rawText,
      delimiter,
      columns: { ...columns, [field]: value === "" ? null : Number(value) },
      checked: false,
    });
  }
  const columnOptions = table.headers.map((name, index) => (
    <option key={index} value={index}>
      {index + 1}. {name}
    </option>
  ));

  return (
    <details className="column-mapper">
      <summary>Map columns from your CSV or TSV</summary>
      <div className="column-mapper-body">
        <p>
          Use your own column names. Preview and check the mapping before
          applying it to the input table. Everything here stays in this browser
          until you submit a prediction.
        </p>
        {!rawText.trim() ? (
          <p>Paste or upload a table above, including its header row.</p>
        ) : (
          <>
            <label
              htmlFor={`${id}-delimiter`}
              className="column-mapper-delimiter"
            >
              Field separator
              <select
                id={`${id}-delimiter`}
                value={delimiter}
                onChange={(event) => {
                  setDelimiter(event.target.value as TableDelimiter);
                  setChoice(null);
                }}
              >
                <option value="auto">Detect from header</option>
                <option value="csv">Comma (CSV)</option>
                <option value="tsv">Tab (TSV)</option>
              </select>
            </label>
            <p className="column-mapper-note">
              Detected format: {table.delimiter === "\t" ? "TSV" : "CSV"}. Row
              numbers below count data rows after the header.
            </p>
            {table.errors.length > 0 ? (
              <div role="alert" className="column-mapper-errors">
                <p>The table needs a correction before mapping.</p>
                <ul>
                  {table.errors.map((message) => (
                    <li key={message}>{message}</li>
                  ))}
                </ul>
              </div>
            ) : (
              <>
                <p id={`${id}-guess-note`}>
                  Recognized headers are suggestions. Confirm that the guide and
                  candidate columns contain the intended 23-nt sequences, each
                  with its own observed 3-nt PAM.
                </p>
                <fieldset
                  aria-describedby={`${id}-guess-note`}
                  className="column-mapper-fields"
                >
                  <legend>Choose the input columns</legend>
                  <label htmlFor={`${id}-guide`}>
                    Guide + PAM · 23 nt
                    <select
                      id={`${id}-guide`}
                      value={columns.guide ?? ""}
                      onChange={(event) => select("guide", event.target.value)}
                    >
                      <option value="">Choose a guide column</option>
                      {columnOptions}
                    </select>
                  </label>
                  <label htmlFor={`${id}-candidate`}>
                    Candidate + PAM · 23 nt
                    <select
                      id={`${id}-candidate`}
                      value={columns.candidate ?? ""}
                      onChange={(event) =>
                        select("candidate", event.target.value)
                      }
                    >
                      <option value="">Choose a candidate column</option>
                      {columnOptions}
                    </select>
                  </label>
                  <label htmlFor={`${id}-id`}>
                    Row identifier
                    <select
                      id={`${id}-id`}
                      value={columns.id ?? ""}
                      onChange={(event) => select("id", event.target.value)}
                    >
                      <option value="">Generate pair-1, pair-2, …</option>
                      {columnOptions}
                    </select>
                  </label>
                </fieldset>
                <p className="column-mapper-count" role="status">
                  {mapped.totalRows.toLocaleString()} data{" "}
                  {mapped.totalRows === 1 ? "row" : "rows"} ·{" "}
                  {mapped.issues.length.toLocaleString()}{" "}
                  {mapped.issues.length === 1 ? "error" : "errors"}
                  {mapped.invalidRows > 0
                    ? ` across ${mapped.invalidRows.toLocaleString()} invalid rows`
                    : ""}
                  .{" "}
                  {mapped.preview.length > 0
                    ? `Previewing the first ${mapped.preview.length} ${mapped.preview.length === 1 ? "row" : "rows"}.`
                    : "Choose both sequence columns to show the preview."}
                </p>
                {mapped.preview.length > 0 && (
                  <div
                    className="column-mapper-table"
                    role="region"
                    aria-label="Mapped input preview"
                    tabIndex={0}
                  >
                    <table>
                      <caption>
                        First {mapped.preview.length} of{" "}
                        {mapped.totalRows.toLocaleString()} data{" "}
                        {mapped.totalRows === 1 ? "row" : "rows"} · checks cover
                        every row
                      </caption>
                      <thead>
                        <tr>
                          <th scope="col">Row / identifier</th>
                          <th scope="col">Guide · PAM in bold</th>
                          <th scope="col">Candidate · PAM in bold</th>
                          <th scope="col">Checks</th>
                        </tr>
                      </thead>
                      <tbody>
                        {mapped.preview.map((row) => (
                          <tr key={row.row}>
                            <th scope="row">
                              {row.row}
                              <span className="column-mapper-row-id">
                                {row.id
                                  ? row.id.slice(0, 100) +
                                    (row.id.length > 100 ? "…" : "")
                                  : "(missing identifier)"}
                              </span>
                            </th>
                            <td>
                              <code>
                                {row.guide.slice(0, 20)}
                                <strong>{row.guide.slice(20, 23)}</strong>
                                {row.guide.slice(23, 40)}
                                {row.guide.length > 40 ? "…" : ""}
                              </code>
                            </td>
                            <td>
                              <code>
                                {row.candidate.slice(0, 20)}
                                <strong>{row.candidate.slice(20, 23)}</strong>
                                {row.candidate.slice(23, 40)}
                                {row.candidate.length > 40 ? "…" : ""}
                              </code>
                            </td>
                            <td>
                              {row.errors.length === 0 &&
                              row.warnings.length === 0 ? (
                                "Sequence format OK"
                              ) : (
                                <ul>
                                  {row.errors.map((message) => (
                                    <li
                                      className="column-mapper-error"
                                      key={message}
                                    >
                                      {message}
                                    </li>
                                  ))}
                                  {row.warnings.map((message) => (
                                    <li key={message}>{message}</li>
                                  ))}
                                </ul>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                {mapped.issues.length > 0 && (
                  <div className="column-mapper-errors" role="alert">
                    <p>
                      Correct the source table or column selections before
                      applying.
                    </p>
                    <ul>
                      {mapped.issues.slice(0, 20).map((issue, index) => (
                        <li key={index}>{issue.message}</li>
                      ))}
                    </ul>
                    {mapped.issues.length > 20 && (
                      <p>
                        Showing 20 of {mapped.issues.length.toLocaleString()}{" "}
                        errors. All errors must be resolved.
                      </p>
                    )}
                  </div>
                )}
                {mapped.warnings.length > 0 && (
                  <div className="column-mapper-warnings">
                    <strong>Interpretation notes</strong>
                    <ul>
                      {mapped.warnings.map((warning) => (
                        <li key={warning}>{warning}</li>
                      ))}
                    </ul>
                  </div>
                )}
                {mapped.preservedColumns.length > 0 && (
                  <p>
                    Metadata retained unchanged:{" "}
                    <code>{mapped.preservedColumns.join(", ")}</code>. This
                    mapping does not verify coordinates, assembly or strand;
                    retain the original coordinate convention.
                  </p>
                )}
                {mapped.omittedColumns.length > 0 && (
                  <p className="column-mapper-warnings">
                    Columns omitted from the mapped table:{" "}
                    <code>{mapped.omittedColumns.join(", ")}</code>. Keep your
                    original file if you need them.
                  </p>
                )}
                <p className="column-mapper-note">
                  Sequences are trimmed at their ends and converted to
                  uppercase. Bases, PAMs and strand orientation are never filled
                  in or changed. A non-NGG guide PAM is a warning in pair
                  scoring; gaps, RNA U and missing bases are errors.
                </p>
                <label className="column-mapper-confirm">
                  <input
                    type="checkbox"
                    checked={current?.checked ?? false}
                    disabled={!mapped.valid}
                    onChange={(event) =>
                      setChoice({
                        source: rawText,
                        delimiter,
                        columns,
                        checked: event.target.checked,
                      })
                    }
                  />
                  I have checked the guide and candidate columns and the
                  retained metadata.
                </label>
                <button
                  type="button"
                  className="column-mapper-apply"
                  disabled={!canApply}
                  onClick={() => {
                    if (canApply) {
                      onApplyTable(mapped.normalizedCsv);
                      setChoice(null);
                    }
                  }}
                >
                  Apply column mapping
                </button>
                <p className="column-mapper-note">
                  Applying replaces the input table. It does not submit a
                  prediction.
                </p>
              </>
            )}
          </>
        )}
      </div>
    </details>
  );
}
