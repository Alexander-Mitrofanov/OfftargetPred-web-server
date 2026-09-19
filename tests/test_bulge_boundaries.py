"""Reject bulged input without retaining a misleading partial candidate universe."""

import asyncio

import httpx
import pytest

from offtargetpred.api import create_app
from offtargetpred.config import Settings
from offtargetpred.search import SearchError, parse_cas_offinder_output


GUIDE = "GATGCTCTCCAGAATCACTGCGG"
QUERY = GUIDE[:20] + "NNN"


@pytest.mark.parametrize("candidate", [
    GUIDE[:8] + "-" + GUIDE[9:],  # 23 aligned columns, one missing DNA base
    GUIDE[:8] + "." + GUIDE[9:],  # alternative gap notation
    GUIDE[:8] + "-" + GUIDE[8:],  # 24 aligned columns, 23 actual DNA bases
    GUIDE[:8] + GUIDE[9:],        # deletion without a gap marker: 22 bases
    GUIDE[:8] + "A" + GUIDE[8:], # insertion without a gap marker: 24 bases
])
def test_search_rejects_entire_output_when_later_candidate_is_bulged(tmp_path, candidate):
    output = tmp_path / "out.tsv"
    output.write_text(
        f"{QUERY}\t1\t42\t{GUIDE}\t+\t0\n"
        f"{QUERY}\t1\t100\t{candidate}\t-\t1\n"
    )
    with pytest.raises(SearchError, match="candidate"):
        parse_cas_offinder_output(output, [{"id": "g1", "target": GUIDE}], 4)


def test_bulge_output_schema_is_not_interpreted_as_six_column_search(tmp_path):
    output = tmp_path / "out.tsv"
    output.write_text(f"DNA\t{QUERY}\t{GUIDE}\t1\t42\t+\t0\t1\t1\n")
    with pytest.raises(SearchError, match="Unexpected Cas-OFFinder output"):
        parse_cas_offinder_output(output, [{"id": "g1", "target": GUIDE}], 4)


def test_pair_api_does_not_queue_valid_prefix_before_gapped_candidate(tmp_path):
    app = create_app(Settings(data_dir=tmp_path, min_free_bytes=0))
    candidate = GUIDE[:8] + "-" + GUIDE[9:]
    payload = {
        "mode": "pairs", "format": "csv", "models": [1],
        "input": f"target,off_target\n{GUIDE},{GUIDE}\n{GUIDE},{candidate}\n",
    }

    async def request():
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://testserver") as client:
            response = await client.post("/api/v1/jobs", json=payload)
            capabilities = await client.get("/api/v1/capabilities")
            return response, capabilities

    response, capabilities = asyncio.run(request())
    assert response.status_code == 422
    assert "gaps" in response.json()["detail"]
    assert capabilities.json()["bulges"] is False
    assert app.state.store.claim() is None
