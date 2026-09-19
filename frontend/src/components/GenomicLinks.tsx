import type { ResultRow } from "../api.ts";
import { buildGenomeLinks } from "../features/genomeLinks.ts";
import "./GenomicLinks.css";

export function GenomicLinks({ row }: { row: ResultRow }) {
  const { locus, links, unavailable } = buildGenomeLinks(row);
  if (!locus) {
    return (
      <span className="genomic-links genomic-links-unavailable">
        Browser links unavailable: {unavailable[0]?.reason}
      </span>
    );
  }
  const interval = `${locus.chromosome}:${locus.displayStart.toLocaleString("en-US")}–${locus.displayEnd.toLocaleString("en-US")}`;
  return (
    <div className="genomic-links">
      <span className="genomic-links-locus">
        {locus.assembly} {interval} ({locus.strand})
      </span>
      <small>1-based, closed · 23 nt including PAM</small>
      <span className="genomic-links-actions">
        {links.map(({ browser, href }) => (
          <a
            key={browser}
            href={href}
            target="_blank"
            rel="noreferrer noopener"
            referrerPolicy="no-referrer"
            aria-label={`Open ${locus.assembly} ${interval} in ${browser} (new tab)`}
          >
            {browser} ↗
          </a>
        ))}
      </span>
      {unavailable.map(({ browser, reason }) => (
        <small key={browser}>
          {browser}: {reason}
        </small>
      ))}
      <small>A click sends this locus to the selected browser.</small>
    </div>
  );
}
