#!/usr/bin/env python3
"""Build a provenance-bound .fai for an existing verified, uncompressed FASTA."""
import argparse
import json
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))
from offtargetpred.reference import build_fasta_index


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("fasta", type=Path)
    parser.add_argument("metadata", type=Path, help="Existing verified reference.json")
    parser.add_argument("--output", type=Path, help="Stage the .fai elsewhere; sidecar .json is also written")
    args = parser.parse_args()
    metadata = json.loads(args.metadata.read_text())
    print(json.dumps(build_fasta_index(args.fasta, metadata, args.output), indent=2))


if __name__ == "__main__":
    main()
