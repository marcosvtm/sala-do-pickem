"""Check recent-form weights with synthetic schedules and public-at-the-time regions."""
import runpy
import unittest
from pathlib import Path

model = runpy.run_path(str(Path(__file__).resolve().parents[1] / "scripts/calibrate-form.py"))
Replay, DAY = model["Replay"], model["DAY"]
probability = model["probability"]


class FormReplayTest(unittest.TestCase):
    def setUp(self):
        self.replay = Replay(0.25, 1.0)
        self.regions = {"a": [[], ["asia"]], "b": [[], ["asia"]], "c": [[], ["europe"]]}
        self.replay.publish(0, self.regions)

    def test_external_and_unknown_rivals_are_distinguished_before_the_update(self):
        self.replay.play(0, "a", "b", 3, 1)
        self.assertAlmostEqual(self.replay.elo("a", 0), 43 * 0.5 * 0.25)
        self.replay.play(0, "a", "c", 3, 1)
        self.replay.play(0, "a", "unknown", 1, 0)
        evidence = self.replay.evidence("a", 0)
        self.assertEqual((evidence["externalOpponents"], evidence["unknownSeries"]), (1, 1))
        self.assertEqual(self.replay.exposure("a", 0), 1)
        self.assertEqual(self.replay.exposure("a", 121 * DAY), 0)

    def test_repeat_is_discounted_in_both_directions(self):
        self.replay.play(0, "a", "c", 3, 1)
        a, c = self.replay.elo("a", 0), self.replay.elo("c", 0)
        self.assertAlmostEqual(a, 21.5)
        self.replay.play(0, "c", "a", 3, 1)
        expected = 43 * (1 - probability(c, a, 3)) / (2 ** 0.5)
        self.assertAlmostEqual(self.replay.elo("c", 0) - c, expected)
        self.assertAlmostEqual(a - self.replay.elo("a", 0), expected)
        self.assertEqual(self.replay.evidence("a", 0)["externalOpponents"], 1)
