import { useId, useRef, useState } from "react";
import citationCff from "../../../CITATION.cff?raw";
import thirdPartyNotices from "../../../THIRD_PARTY_NOTICES.md?raw";
import "./ServiceInformation.css";

const REPOSITORY =
  "https://github.com/Alexander-Mitrofanov/OfftargetPred-web-server";

export const SOFTWARE_CITATION =
  "OfftargetPred contributors (2026). OfftargetPred: a web interface to " +
  "sequence-only CRISPert-small models. Version " +
  "0.2.0 (19 September 2026). " +
  REPOSITORY;

const PAPER_CITATION =
  "William Jobson Pargeter, Rolf Backofen and Van Dinh Tran (2024). " +
  "CRISPert: A Transformer-Based Model for CRISPR-Cas Off-Target Prediction. " +
  "ECML PKDD, pp. 92–104. https://doi.org/10.1007/978-3-031-70368-3_6";

const CITATION_TEXT = `${PAPER_CITATION}\n\n${SOFTWARE_CITATION}\n\nRecord the actual software release or commit, checkpoint hashes and analysis settings used. No software DOI has been assigned.`;

function textDownload(content: string) {
  return `data:text/plain;charset=utf-8,${encodeURIComponent(content)}`;
}

export function ServiceInformation() {
  const headingId = useId();
  const citationId = useId();
  const citationField = useRef<HTMLTextAreaElement>(null);
  const [copyStatus, setCopyStatus] = useState("");

  async function copyCitation() {
    try {
      if (!navigator.clipboard?.writeText)
        throw new Error("Clipboard unavailable");
      await navigator.clipboard.writeText(CITATION_TEXT);
      setCopyStatus("Citations copied.");
    } catch {
      citationField.current?.focus();
      citationField.current?.select();
      setCopyStatus(
        "Automatic copy is unavailable. The citations are selected for manual copying.",
      );
    }
  }

  return (
    <section className="service-information" aria-labelledby={headingId}>
      <h2 id={headingId}>About, citation and support</h2>
      <p>
        OfftargetPred is a free web interface to published CRISPert, with no
        account required. It uses three unchanged, sequence-only CRISPert-small
        models. Scores are uncalibrated model outputs; paper results do not
        automatically describe these exact checkpoints.{" "}
        <a href={`${REPOSITORY}/blob/main/docs/model-card.md`}>
          Model scope and limitations
        </a>
      </p>

      <div className="service-information-grid">
        <div>
          <h3>Cite the method and this interface</h3>
          <p>
            Jobson Pargeter, Backofen and Tran (2024).{" "}
            <a href="https://link.springer.com/chapter/10.1007/978-3-031-70368-3_6">
              CRISPert: A Transformer-Based Model for CRISPR-Cas Off-Target
              Prediction
            </a>
            . ECML PKDD, pp. 92–104.
          </p>
          <p className="service-information-note">
            Software citation: version 0.2.0, 19 September 2026. No software DOI
            has been assigned. Include the actual commit and model hashes from your
            run.
          </p>
          <label htmlFor={citationId}>Copyable citations</label>
          <textarea
            id={citationId}
            ref={citationField}
            value={CITATION_TEXT}
            readOnly
            rows={7}
            spellCheck={false}
          />
          <div className="service-information-actions">
            <button type="button" onClick={copyCitation}>
              Copy citations
            </button>
            <a href={textDownload(citationCff)} download="CITATION.cff">
              Download citation (CFF)
            </a>
          </div>
          <p
            className="service-information-status"
            role="status"
            aria-live="polite"
          >
            {copyStatus}
          </p>
        </div>

        <div>
          <h3>Licence and source</h3>
          <p>
            Project-owned code and documentation use the MIT licence. Keep its
            copyright and permission notice when reusing the code. Third-party
            components have their own terms. Redistribution permission for the
            supplied tokenizer, weights and datasets remains unverified; they
            are excluded from this MIT grant.
          </p>
          <ul className="service-information-links">
            <li>
              <a href={`${import.meta.env.BASE_URL}license.txt`}>
                Project code licence (MIT)
              </a>
            </li>
            <li>
              <a href={REPOSITORY}>Source repository</a>
            </li>
            <li>
              <a href={`${REPOSITORY}/blob/main/docs/licensing.md`}>
                Licence scope and attribution
              </a>
            </li>
            <li>
              <a
                href={textDownload(thirdPartyNotices)}
                download="THIRD_PARTY_NOTICES.md"
              >
                Download third-party notices
              </a>
            </li>
          </ul>
          <h3>Help and maintenance</h3>
          <p>
            Maintainer:{" "}
            <a href="https://github.com/Alexander-Mitrofanov">
              Alexander-Mitrofanov
            </a>
            . Use <a href={`${REPOSITORY}/issues`}>repository issues</a> for
            questions and bug reports. Issues are public; keep private job
            links, tokens and confidential sequences out of reports.
          </p>
        </div>
      </div>
    </section>
  );
}
