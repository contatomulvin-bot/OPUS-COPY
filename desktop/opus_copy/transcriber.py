from __future__ import annotations

import json
import os
from pathlib import Path

from .tools import ToolError


class WhisperXTranscriber:
    """Fast local Whisper transcription powered by faster-whisper.

    The historical class name is kept for compatibility with the desktop pipeline.
    The actual engine is faster-whisper/CTranslate2, including native AMD ROCm
    acceleration when the ROCm CTranslate2 wheel is installed.
    """

    def __init__(self) -> None:
        try:
            from faster_whisper import WhisperModel  # type: ignore
        except ImportError as exc:
            raise ToolError("faster-whisper não está instalado neste ambiente Python.") from exc
        self.WhisperModel = WhisperModel
        self._model = None
        self._model_key: tuple[str, str, str, int, int] | None = None

    @staticmethod
    def _cuda_available() -> bool:
        """Ask CTranslate2 directly instead of relying on torch CUDA detection.

        This works for both NVIDIA CUDA builds and AMD ROCm builds, where the
        CTranslate2 runtime still exposes the GPU backend as `cuda`.
        """
        try:
            import ctranslate2  # type: ignore

            get_count = getattr(ctranslate2, "get_cuda_device_count", None)
            if callable(get_count):
                return int(get_count()) > 0
        except Exception:  # noqa: BLE001 - unsupported/broken GPU runtimes must fall back to CPU
            return False
        return False

    @classmethod
    def _device_settings(cls) -> tuple[str, str]:
        requested = os.getenv("WHISPER_DEVICE", os.getenv("WHISPERX_DEVICE", "auto")).strip().lower()
        if requested == "auto":
            device = "cuda" if cls._cuda_available() else "cpu"
        else:
            device = requested

        if device not in {"cpu", "cuda"}:
            device = "cpu"

        default_compute = "float16" if device == "cuda" else "int8"
        compute = os.getenv("WHISPER_COMPUTE_TYPE", os.getenv("WHISPERX_COMPUTE_TYPE", default_compute)).strip()
        return device, compute

    @staticmethod
    def _thread_settings() -> tuple[int, int]:
        # Some CTranslate2 Windows/ROCm builds reject ``None`` for
        # ``intra_threads``.  Always pass a concrete, positive integer instead
        # of relying on faster-whisper's automatic/default thread handling.
        default_cpu_threads = max(1, min(os.cpu_count() or 4, 8))
        try:
            cpu_threads = int(os.getenv("WHISPER_CPU_THREADS", str(default_cpu_threads)))
            if cpu_threads < 1:
                cpu_threads = default_cpu_threads
        except ValueError:
            cpu_threads = default_cpu_threads
        try:
            num_workers = max(1, int(os.getenv("WHISPER_NUM_WORKERS", "1")))
        except ValueError:
            num_workers = 1
        return cpu_threads, num_workers

    def _get_model(self, model_name: str):
        device, compute_type = self._device_settings()
        cpu_threads, num_workers = self._thread_settings()
        key = (model_name, device, compute_type, cpu_threads, num_workers)
        if self._model is None or self._model_key != key:
            kwargs = {
                "device": device,
                "compute_type": compute_type,
                "cpu_threads": cpu_threads,
                "num_workers": num_workers,
            }
            try:
                self._model = self.WhisperModel(model_name, **kwargs)
            except Exception as exc:
                if device == "cuda" and os.getenv("WHISPER_GPU_FALLBACK", "true").strip().lower() in {"1", "true", "yes", "on"}:
                    fallback_compute = os.getenv("WHISPER_CPU_COMPUTE_TYPE", "int8").strip() or "int8"
                    self._model = self.WhisperModel(
                        model_name,
                        device="cpu",
                        compute_type=fallback_compute,
                        cpu_threads=cpu_threads,
                        num_workers=num_workers,
                    )
                    self._model_key = (model_name, "cpu", fallback_compute, cpu_threads, num_workers)
                    return self._model, "cpu", fallback_compute
                raise ToolError(f"Falha ao iniciar faster-whisper na GPU ({device}/{compute_type}): {exc}") from exc
            self._model_key = key
        return self._model, device, compute_type

    def transcribe(self, audio_or_video: Path, language: str = "pt", model_name: str | None = None) -> dict:
        if not audio_or_video.exists() or audio_or_video.stat().st_size == 0:
            raise ToolError(f"Arquivo de mídia inválido: {audio_or_video}")

        model_name = model_name or os.getenv("WHISPER_MODEL", os.getenv("WHISPERX_MODEL", "small"))
        model, device, compute_type = self._get_model(model_name)
        requested_language = (language or "pt").strip().lower() or None

        try:
            segments_iter, info = model.transcribe(
                str(audio_or_video),
                language=requested_language,
                word_timestamps=True,
                vad_filter=True,
                beam_size=int(os.getenv("WHISPER_BEAM_SIZE", "5")),
                condition_on_previous_text=False,
                temperature=0,
            )

            segments: list[dict] = []
            text_parts: list[str] = []
            for segment in segments_iter:
                words = []
                for word in segment.words or []:
                    start = getattr(word, "start", None)
                    end = getattr(word, "end", None)
                    value = str(getattr(word, "word", "")).strip()
                    if start is None or end is None or not value or end <= start:
                        continue
                    words.append({
                        "word": value,
                        "start": round(float(start), 3),
                        "end": round(float(end), 3),
                    })

                start = float(segment.start)
                end = float(segment.end)
                segment_text = str(segment.text or "").strip()
                if end <= start or not segment_text:
                    continue

                segments.append({
                    "start": start,
                    "end": end,
                    "text": segment_text,
                    "words": words,
                })
                text_parts.append(segment_text)

            if not segments:
                raise ToolError("faster-whisper não retornou segmentos de fala.")

            detected_language = getattr(info, "language", None) or requested_language or "pt"
            return {
                "language": detected_language,
                "text": " ".join(text_parts).strip(),
                "segments": segments,
                "engine": "faster-whisper",
                "device": device,
                "compute_type": compute_type,
            }
        except ToolError:
            raise
        except Exception as exc:
            raise ToolError(f"Falha na transcrição local com faster-whisper ({device}/{compute_type}): {exc}") from exc


def save_transcript(data: dict, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
