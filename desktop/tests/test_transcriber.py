import os
import unittest
from unittest.mock import patch

from opus_copy.transcriber import WhisperXTranscriber


class FakeWhisperModel:
    def __init__(self, model_name, **kwargs):
        self.model_name = model_name
        self.kwargs = kwargs


class TranscriberConfigurationTests(unittest.TestCase):
    def test_model_always_receives_positive_integer_cpu_threads(self):
        transcriber = WhisperXTranscriber.__new__(WhisperXTranscriber)
        transcriber.WhisperModel = FakeWhisperModel
        transcriber._model = None
        transcriber._model_key = None

        with (
            patch.object(transcriber, "_device_settings", return_value=("cpu", "int8")),
            patch.dict(os.environ, {"WHISPER_CPU_THREADS": "0"}, clear=False),
        ):
            model, device, compute_type = transcriber._get_model("small")

        self.assertEqual(device, "cpu")
        self.assertEqual(compute_type, "int8")
        self.assertIsInstance(model.kwargs["cpu_threads"], int)
        self.assertGreaterEqual(model.kwargs["cpu_threads"], 1)

    def test_invalid_thread_environment_uses_safe_defaults(self):
        with patch.dict(
            os.environ,
            {"WHISPER_CPU_THREADS": "invalid", "WHISPER_NUM_WORKERS": "invalid"},
            clear=False,
        ):
            cpu_threads, num_workers = WhisperXTranscriber._thread_settings()

        self.assertGreaterEqual(cpu_threads, 1)
        self.assertEqual(num_workers, 1)


if __name__ == "__main__":
    unittest.main()
