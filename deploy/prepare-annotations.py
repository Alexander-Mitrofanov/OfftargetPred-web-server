#!/usr/bin/env python3
"""Prepare the pinned Ensembl 115 GRCh38 annotation index entirely offline.

Download SOURCE_URL separately on the data VM. No arbitrary URL or assembly is
accepted. Source/archive, expanded GTF, FASTA and generated index hashes are kept.
"""
import argparse
import json
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))
from offtargetpred.annotations import (SOURCE_SHA256, SOURCE_URL, build_annotation_index,
                                     read_reference_contigs)

REFERENCE_SHA256 = "1e74081a49ceb9739cc14c812fbb8b3db978eb80ba8e5350beb80d8ad8dfef3b"
REFERENCE_URL = "https://ftp.ensembl.org/pub/release-115/fasta/homo_sapiens/dna/Homo_sapiens.GRCh38.dna.primary_assembly.fa.gz"


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("archive", type=Path, help=f"{SOURCE_URL} (SHA-256 {SOURCE_SHA256})")
    parser.add_argument("destination", type=Path, help="New .sqlite index file; .json manifest is written beside it")
    parser.add_argument("--reference-metadata", type=Path, required=True)
    args = parser.parse_args()
    reference = json.loads(args.reference_metadata.read_text())
    if reference.get("sha256") != REFERENCE_SHA256 or reference.get("source_url") != REFERENCE_URL:
        raise SystemExit("Annotations require the pinned Ensembl 115 GRCh38 primary assembly reference")
    filename = reference.get("filename", "")
    if not filename or Path(filename).name != filename:
        raise SystemExit("Reference filename must name one installed FASTA")
    contigs = read_reference_contigs(args.reference_metadata.parent / filename, REFERENCE_SHA256)
    manifest = build_annotation_index(args.archive, args.destination, reference=reference, contig_lengths=contigs)
    print(json.dumps(manifest, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
