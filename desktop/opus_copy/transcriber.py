from __future__ import annotations

import json
import os
from pathlib import Path

from .tools import ToolError


class WhisperXTranscriber:
    def __init__(self) -> None:
        try:
            import whisperx  # type: ignore
        except ImportError as exc:
            raise ToolError("WhisperX não está instalado neste ambiente Python.") from exc
        self.whisperx = whisperx

    def transcribe(self, audio_or_video: Path, language: str = "pt", model_name: str | None = None) -> dict:
        if not audio_or_video.exists() or audio_or_video.stat().st_size == 0:
            raise ToolError(f"Arquivo de mídia inválido: {audio_or_video}")

        model_name = model_name or os.getenv("WHISPERX_MODEL", "small")
        device = os.getenv("WHISPERX_DEVICE", "cpu")
        compute_type = os.getenv("WHISPERX_COMPUTE_TYPE", "int8" if device == "cpu" else "float16")
        batch_size = int(os.getenv("WHISPERX_BATCH_SIZE", "8"))

        model = self.whisperx.load_model(model_name, device=device, compute_type=compute_type)
        result = model.transcribe(str(audio_or_video), batch_size=batch_size, language=language)
        detected_language = result.get("language") or language

        try:
            align_model, metadata = self.whisperx.load_align_model(
                language_code=detected_language,
                device=device,
            )
            result = self.whisperx.align(
                result["segments"],
                align_model,
                metadata,
                str(audio_or_video),
                device,
                return_char_alignments=False,
            )
        except Exception:
            # Segment timestamps remain usable when the language has no alignment model.
            pass

        segments = []
        for segment in result.get("segments", []):
            words = []
            for word in segment.get("words", []) or []:
                if "start" in word and "end" in word:
                    words.append({
                        "word": str(word.get("word", "")).strip(),
                        "start": float(word["start"]),
                        "end": float(word["end"]),
                    })
            segments.append({
                "start": float(segment.get("start", 0)),
                "end": float(segment.get("end", 0)),
                "text": str(segment.get("text", "")).strip(),
                "words": words,
            })

        return {"language": detected_language, "segments": segments}


def save_transcript(data: dict, path: Path) -> None:
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
