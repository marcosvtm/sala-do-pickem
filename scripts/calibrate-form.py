"""Fit recent-form update weights chronologically and replay the frozen Stage 1 field."""
import argparse
import gzip
import json
import math
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DAY = 86400
WINDOW = 120 * DAY
SELECTION = [(floor, repeat) for floor in (0.25, 0.5, 0.75) for repeat in (0.5, 1.0)]


def decay(seconds, half_life):
    return 2 ** (-seconds / (half_life * DAY))


def probability(a, b, bo):
    return 1 / (1 + math.exp(-(a - b) / 170 * (0.73 if bo == 1 else 1)))


class Replay:
    def __init__(self, floor, repeat):
        self.floor = floor
        self.repeat = repeat
        self.rating = {}
        self.rank = {}
        self.external = defaultdict(dict)
        self.meetings = {}
        self.schedule = defaultdict(list)

    def elo(self, team, now):
        value, last = self.rating.get(team, (0, now))
        return value * decay(now - last, 160)

    def publish(self, now, table):
        for team in self.rating.keys() & self.rank.keys() & table.keys():
            retained = len(set(self.rank[team][0]) & set(table[team][0]))
            self.rating[team] = self.elo(team, now) * (retained / 5) ** 2, now
        self.rank = table

    def region_status(self, a, b):
        ra = self.rank.get(a, ((), ()))[1]
        rb = self.rank.get(b, ((), ()))[1]
        if not ra or not rb:
            return "unknown"
        return "external" if set(ra).isdisjoint(rb) else "shared"

    def exposure(self, team, now):
        return sum(decay(now - last, 60) for last in self.external[team].values()
                   if now - last <= WINDOW)

    def play(self, now, a, b, bo, y):
        first, second = self.elo(a, now), self.elo(b, now)
        region = self.region_status(a, b)
        cross = region == "external"
        exposure = min(1, max(self.exposure(a, now), self.exposure(b, now)) / 4)
        evidence = 1 if cross else self.floor + (1 - self.floor) * exposure
        pair = tuple(sorted((a, b)))
        repeats, last = self.meetings.get(pair, (0, now))
        repeats *= decay(now - last, 60)
        weight = evidence / math.sqrt(1 + self.repeat * repeats)
        change = (32 if bo == 1 else 43) * weight * (y - probability(first, second, bo))
        self.rating[a], self.rating[b] = (first + change, now), (second - change, now)
        self.meetings[pair] = repeats + 1, now
        if cross:
            self.external[a][b] = self.external[b][a] = now
        self.schedule[a].append((now, b, region))
        self.schedule[b].append((now, a, region))

    def evidence(self, team, now):
        games = [g for g in self.schedule[team] if 0 <= now - g[0] <= WINDOW]
        return {"series": len(games), "opponents": len({g[1] for g in games}),
                "externalSeries": sum(g[2] == "external" for g in games),
                "externalOpponents": len({g[1] for g in games if g[2] == "external"}),
                "unknownSeries": sum(g[2] == "unknown" for g in games)}


def prepare(history):
    matches = {m[-1]: m for m in history["matches"]}
    items = [(m[0], 2, index, m[1:-1]) for index, m in enumerate(history["matches"])]
    items.extend((r["at"], 1, i, r["teams"]) for i, r in enumerate(history["rankings"]))
    for cutoff, match_id, split in history["evaluation"]:
        items.append((cutoff, 0, match_id, [*matches[match_id][1:5], split]))
    return sorted(items, key=lambda entry: entry[:3])


def replay(items, floor, repeat):
    model = Replay(floor, repeat)
    predictions = []
    for at, kind, _, data in items:
        if kind == 2:
            model.play(at, *data)
        elif kind == 1:
            model.publish(at, data)
        else:
            a, b, bo, y, split = data
            p = probability(model.elo(a, at), model.elo(b, at), bo)
            cross = model.region_status(a, b) == "external"
            sparse = min(model.evidence(t, at)["externalOpponents"] for t in (a,b)) < 2
            predictions.append((split, cross, sparse, p, y))
    return model, predictions


def scores(predictions, split, group="all"):
    sample = [(p, y) for period, cross, sparse, p, y in predictions if period == split
              and (group == "all" or cross and (group == "cross" or sparse))]
    if not sample:
        return {"n": 0}
    return {"n": len(sample), "brier": sum((p-y)**2 for p,y in sample)/len(sample),
            "logLoss": -sum(math.log(p if y else 1-p) for p,y in sample)/len(sample)}


def main(write):
    history = json.loads(gzip.decompress((ROOT / "research/form-history.json.gz").read_bytes()))
    items = prepare(history)
    # Freeze the candidate using June–August only. September onward is reported separately.
    baseline, previous = replay(items, 1, 0)
    best = math.inf
    for floor, repeat in SELECTION:
        model, predictions = replay(items, floor, repeat)
        loss = scores(predictions, "selection")["logLoss"]
        if loss < best:
            best, chosen, revised, current = loss, (floor, repeat), model, predictions
    print("Selected floor, repeat:", chosen)
    for period in ("selection", "test"):
        for group in ("all", "cross", "sparse-cross"):
            print(period, group, "old", scores(previous, period, group), "revised", scores(current, period, group))
    path = ROOT / "dist/data/stage.json"
    stage = json.loads(path.read_text(encoding="utf-8"))
    for team, key in zip(stage["teams"], history["field"], strict=True):
        now = history["cutoff"]
        # Same announced substitute as the original Stage 1 freeze.
        retention = 0.64 if key == "9z" else 1
        assert abs(baseline.elo(key, now) * retention - team["elo"]) < 1e-7
        team["formElo"] = round(revised.elo(key, now) * retention, 8)
        team["formEvidence"] = revised.evidence(key, now)
        print(key, round(team["elo"], 2), team["formElo"], team["formEvidence"])
    if write:
        path.write_bytes((json.dumps(stage, indent=2, ensure_ascii=False) + "\n").encode())


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--write", action="store_true", help="Update the stage snapshot after validation")
    main(parser.parse_args().write)
