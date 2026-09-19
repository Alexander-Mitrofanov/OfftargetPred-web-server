import type { AnnotationResult } from "../api";
import "./AnnotationDetails.css";

export function AnnotationDetails({ annotations }: { annotations?: AnnotationResult | null }) {
  if (!annotations || annotations.status !== "annotated") {
    const noCoordinates = annotations?.status === "no_coordinates";
    return (
      <details className="annotation-details annotation-details-unavailable">
        <summary>{noCoordinates ? "No coordinates" : "Annotation unavailable"}</summary>
        <p>{annotations?.reason || "Compatible local annotation data are unavailable for this site."}</p>
      </details>
    );
  }
  const genes = [...new Set(annotations.features.map((feature) => feature.gene_name || feature.gene_id))];
  const transcripts = annotations.transcript_count ?? new Set(annotations.features.map((feature) => feature.transcript_id).filter(Boolean)).size;
  const categories = annotations.categories.length ? annotations.categories.join(" · ") : "Gene overlap";
  return (
    <details className="annotation-details">
      <summary>
        <span>{categories}</span>
        {genes.length > 0 && <small>{genes.slice(0, 2).join(", ")}{genes.length > 2 ? ` +${genes.length - 2}` : ""}</small>}
      </summary>
      <div className="annotation-details-body">
        <p>{annotations.source || "Ensembl"} {annotations.release || "115"}; overlap across the full 23-nt site, including PAM, on either feature strand.</p>
        {annotations.categories.includes("intergenic") && <p>No gene or transcript overlaps this site in the matched annotation release.</p>}
        {transcripts > 1 && <p>{transcripts} transcripts overlap. Categories can differ between transcripts; no single transcript is selected.</p>}
        {annotations.features.length > 0 && (
          <div className="annotation-details-scroll" tabIndex={0} role="region" aria-label="Overlapping gene and transcript features">
            <table>
              <caption>Overlapping features; coordinates are 0-based, half-open.</caption>
              <thead><tr><th scope="col">Gene</th><th scope="col">Transcript</th><th scope="col">Feature</th><th scope="col">Interval</th><th scope="col">Strand</th></tr></thead>
              <tbody>{annotations.features.map((feature, i) => (
                <tr key={`${feature.gene_id}-${feature.transcript_id}-${feature.feature}-${feature.start}-${feature.end}-${i}`}>
                  <td>{feature.gene_name || feature.gene_id}<small>{feature.gene_id}</small></td>
                  <td>{feature.transcript_id || "—"}</td>
                  <td>{feature.feature}</td>
                  <td>{feature.start.toLocaleString()}–{feature.end.toLocaleString()}</td>
                  <td>{feature.strand}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
        <p className="annotation-details-note">Genomic context does not establish functional harm and does not change model scores.</p>
      </div>
    </details>
  );
}
