from __future__ import annotations

import json
import os
from pathlib import Path

from .tools import ToolError


class WhisperXTranscriber:
    """Fast local Whisper transcription.

    Kept under the historical class name so the desktop pipeline remains compatible.
    Unlike WhisperX, this does not run a second wav2vec2 alignment pass: faster-whisper
    already exposes word timestamps, which removes a major source of latency.
    """

    def __init__(self) -> None:
        try:
            from faster_whisper import WhisperModel  # type: ignore
        except ImportError as exc:
            raise ToolError("faster-whisper não está instalado neste ambiente Python.") from exc
        self.WhisperModel = WhisperModel
        self._model = None
        self._model_key: tuple[str, str, str] | None = None

    @staticmethod
    def _device_settings() -> tuple[str, str]:
        requested = os.getenv("WHISPER_DEVICE", os.getenv("WHISPERX_DEVICE", "auto")).strip().lower()
        if requested == "auto":
            # CUDA is selected only when explicitly available to faster-whisper.
            # AMD GPUs on Windows do not expose CUDA, so they safely fall back to CPU.
            try:
                import torch  # type: ignore
                device = "cuda" if torch.cuda.is_available() else "cpu"
            except Exception:
                device = "cpu"
        else:
            device = requested

        if device not in {"cpu", "cuda"}:
            device = "cpu"

        default_compute = "float16" if device == "cuda" else "int8"
        compute = os.getenv("WHISPER_COMPUTE_TYPE", os.getenv("WHISPERX_COMPUTE_TYPE", default_compute)).strip()
        return device, compute

    def _get_model(self, model_name: str):
        device, compute_type = self._device_settings()
        key = (model_name, device, compute_type)
        if self._model is None or self._model_key != key:
            self._model = self.WhisperModel(
                model_name,
                device=device,
                compute_type=compute_type,
                cpu_threads=int(os.getenv("WHISPER_CPU_THREADS", "0")) or None,
                num_workers=max(1, int(os.getenv("WHISPER_NUM_WORKERS", "1"))),
            )
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
            raise ToolError(f"Falha na transcrição local ({device}/{compute_type}): {exc}") from exc


def save_transcript(data: dict, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
