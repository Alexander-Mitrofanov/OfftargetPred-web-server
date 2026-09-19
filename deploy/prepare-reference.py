#!/usr/bin/env python3
"""Verify and expand the fixed Ensembl reference; never accepts an arbitrary URL."""
import argparse
import gzip
import hashlib
import json
import os
from pathlib import Path

URL = "https://ftp.ensembl.org/pub/release-115/fasta/homo_sapiens/dna/Homo_sapiens.GRCh38.dna.primary_assembly.fa.gz"
COMPRESSED_SHA256 = "d8c3af0094a7bba6125763bad779ec18a81483c739c6ed122094bdf86c187b92"
FILENAME = "Homo_sapiens.GRCh38.dna.primary_assembly.fa"

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("archive", type=Path)
    parser.add_argument("destination", type=Path)
    args = parser.parse_args()
    with args.archive.open("rb") as stream:
        digest = hashlib.file_digest(stream, "sha256").hexdigest()
    if digest != COMPRESSED_SHA256:
        raise SystemExit("Reference archive SHA-256 mismatch")
    args.destination.mkdir(parents=True, exist_ok=True)
    destination = args.destination / FILENAME
    if destination.exists():
        raise SystemExit("Reference already exists; refusing to overwrite")
    temporary = destination.with_suffix(".partial")
    sha = hashlib.sha256()
    contigs, bases = 0, 0
    with gzip.open(args.archive, "rb") as source, temporary.open("xb") as output:
        for line in source:
            sha.update(line)
            output.write(line)
            if line.startswith(b">"):
                contigs += 1
            else:
                bases += len(line.strip())
        output.flush()
        os.fsync(output.fileno())
    if contigs < 24 or bases < 3_000_000_000:
        raise SystemExit("Reference does not contain the expected human primary assembly")
    temporary.replace(destination)
    metadata = {
        "id": "GRCh38", "assembly": "GRCh38",
        "name": "Human GRCh38 primary assembly (Ensembl 115)",
        "filename": FILENAME, "sha256": sha.hexdigest(), "verified": True,
        "source_url": URL, "compressed_sha256": digest,
        "publisher_bsd_checksum": "22450 861294",
        "contigs": contigs, "total_bases": bases,
        "scope": "Primary assembly only; excludes alternate haplotypes and individual variants",
        "coordinate_system": "0-based start, half-open end, forward-reference coordinates",
    }
    (args.destination / "reference.json").write_text(json.dumps(metadata, indent=2) + "\n")
    print(json.dumps(metadata, indent=2))

if __name__ == "__main__":
    main()
