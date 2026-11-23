"""Build the compact offline replay input from the original frozen forecast archive."""
import argparse
import csv
import gzip
import json
import sys
from datetime import datetime
from pathlib import Path
from urllib.request import urlopen

ROOT = Path(__file__).resolve().parents[1]


def seconds(date):
    return int(datetime.fromisoformat(date.replace("Z", "+00:00")).timestamp())


def prepare(archive):
    # The original edition owns the match filters, aliases and publication times.
    sys.path.insert(0, str(archive.resolve()))
    import model as original

    source = archive / "source"
    rankings = []
    for meta, (_, global_table, _) in zip(
        json.loads((source / "rank-publications.json").read_text()), original.read_ranks(), strict=True
    ):
        regions = {}
        for region in ("americas", "asia", "europe"):
            url = meta["url"].replace("standings_global_", "standings_" + region + "_")
            with urlopen(url, timeout=30) as response:
                table = response.read().decode("utf-8-sig")
            if not table or region not in table.splitlines()[0].lower() or "| Standing" not in table:
                raise ValueError(f"Unexpected standings format at {url}")
            for line in table.splitlines():
                cols = [c.strip() for c in line.split("|")]
                if len(cols) < 6 or not cols[1].isdigit():
                    continue
                team = original.key(cols[3])
                lineup = {original.key(p) for p in cols[4].split(",")}
                if team in global_table and lineup == global_table[team][1]:
                    regions.setdefault(team, set()).add(region)
        teams = {team: [sorted(roster), sorted(regions.get(team, ()))]
                 for team, (_, roster, _) in global_table.items()}
        rankings.append({"at": seconds(meta["published"]), "source": meta["url"], "teams": teams})
    matches = [[seconds(m["end"]), m["ka"], m["kb"], m["bo"], m["y"], m["id"]]
               for m in original.read_matches()]
    with (archive / "v1" / "heldout.csv").open(encoding="utf-8") as f:
        evaluation = [[seconds(m["event_cutoff"]), int(m["id"]), m["split"]]
                      for m in csv.DictReader(f)]
    history = {"cutoff": seconds(original.FREEZE), "rankings": rankings, "matches": matches,
               "evaluation": evaluation, "field": [original.key(t) for t in original.NAMES]}
    data = json.dumps(history, separators=(",", ":"), ensure_ascii=False).encode()
    (ROOT / "research/form-history.json.gz").write_bytes(gzip.compress(data, mtime=0))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("archive", type=Path, help="Original forecast/ directory containing model.py")
    prepare(parser.parse_args().archive)
