import unittest

from opus_copy.autoframe import (
    CropKeyframe,
    ReframePlan,
    _choose_tracked_face,
    _crop_x_expression,
    _fill_missing_positions,
    _sample_times,
    _simplify_keyframes,
    _smooth_crop_positions,
)


class AutoFrameTests(unittest.TestCase):
    def test_sample_times_cover_the_entire_clip_with_a_hard_limit(self):
        times = _sample_times(duration=90.0, interval=0.2, max_samples=120)
        self.assertEqual(len(times), 120)
        self.assertEqual(times[0], 0.0)
        self.assertGreater(times[-1], 89.0)

    def test_tracker_prefers_continuity_when_two_faces_are_visible(self):
        faces = [(80, 10, 100, 100), (700, 10, 150, 150)]
        selected = _choose_tracked_face(faces, previous_center=130.0, frame_width=1000)
        self.assertEqual(selected, faces[0])

    def test_missing_detections_are_interpolated(self):
        result = _fill_missing_positions(
            [0.0, 1.0, 2.0, 3.0],
            [100.0, None, None, 400.0],
            fallback=250.0,
        )
        self.assertEqual(result, [100.0, 200.0, 300.0, 400.0])

    def test_smoothing_rejects_one_frame_false_detection_and_stays_in_bounds(self):
        times = [0.0, 0.4, 0.8, 1.2, 1.6, 2.0]
        centers = [300.0, 305.0, 1200.0, 310.0, 315.0, 320.0]
        points = _smooth_crop_positions(times, centers, frame_width=1920, crop_width=608)
        self.assertTrue(all(0 <= point.x <= 1312 for point in points))
        self.assertLess(max(point.x for point in points) - min(point.x for point in points), 80)

    def test_ffmpeg_expression_interpolates_between_keyframes(self):
        expression = _crop_x_expression((CropKeyframe(0.0, 100), CropKeyframe(1.0, 300)))
        self.assertIn("if(lt(t,1.000)", expression)
        self.assertIn("100+(200)*(t-0.000)/1.000", expression)

    def test_keyframe_simplification_preserves_a_pan_reversal(self):
        points = [
            CropKeyframe(0.0, 0),
            CropKeyframe(1.0, 250),
            CropKeyframe(2.0, 500),
            CropKeyframe(3.0, 250),
            CropKeyframe(4.0, 0),
        ]
        simplified = _simplify_keyframes(points)
        self.assertIn(CropKeyframe(2.0, 500), simplified)

    def test_filter_escapes_expression_commas_for_ffmpeg(self):
        plan = ReframePlan(
            frame_width=1920,
            crop_width=608,
            keyframes=(CropKeyframe(0.0, 100), CropKeyframe(1.0, 300)),
            mode="face-track",
        )
        value = plan.ffmpeg_crop_filter()
        self.assertTrue(value.startswith("crop=608:ih:"))
        self.assertIn(r"\,", value)


if __name__ == "__main__":
    unittest.main()
