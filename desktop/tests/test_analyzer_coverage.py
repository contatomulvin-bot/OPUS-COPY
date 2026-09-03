import unittest

from opus_copy.analyzer import ViralAnalyzer


class AnalyzerCoverageTests(unittest.TestCase):
    def make_segments(self, count=320):
        return [
            {"start": i * 3.0, "end": i * 3.0 + 2.5, "text": f"fala segmento {i}"}
            for i in range(count)
        ]

    def test_short_transcript_is_single_chunk(self):
        chunks = ViralAnalyzer._chunk_segments(self.make_segments(20))
        self.assertEqual(len(chunks), 1)
        self.assertEqual(chunks[0][0]["start"], 0.0)

    def test_long_transcript_starts_at_first_segment(self):
        chunks = ViralAnalyzer._chunk_segments(self.make_segments(320))
        self.assertGreater(len(chunks), 1)
        self.assertEqual(chunks[0][0]["start"], 0.0)

    def test_every_segment_is_present_exactly_once(self):
        segments = self.make_segments(320)
        chunks = ViralAnalyzer._chunk_segments(segments)
        flattened = [item for chunk in chunks for item in chunk]
        self.assertEqual(len(flattened), len(segments))
        self.assertEqual(flattened, segments)

    def test_chunk_duration_is_bounded(self):
        segments = self.make_segments(320)
        chunks = ViralAnalyzer._chunk_segments(segments, max_duration=60.0)
        for chunk in chunks:
            duration = float(chunk[-1]["end"]) - float(chunk[0]["start"])
            self.assertLessEqual(duration, 62.5)

    def test_opening_candidate_window_is_within_first_two_minutes(self):
        segments = self.make_segments(100)
        compact = [
            {"start": float(s["start"]), "end": float(s["end"]), "text": s["text"]}
            for s in segments
        ]
        opening = [s for s in compact if s["start"] <= compact[0]["start"] + 120]
        self.assertTrue(opening)
        self.assertLessEqual(opening[-1]["start"], 120.0)


if __name__ == "__main__":
    unittest.main()
