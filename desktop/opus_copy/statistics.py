from __future__ import annotations

import math
import re


def clip_statistics(transcript: dict, clip, score_breakdown: dict[str, float] | None = None) -> dict:
    """Calculate transparent editorial statistics; these are not real platform analytics."""
    words: list[dict] = []
    text_parts: list[str] = []
    for segment in transcript.get("segments", []):
        start = float(segment.get("start", 0))
        end = float(segment.get("end", 0))
        if end <= clip.start or start >= clip.end:
            continue
        text = str(segment.get("text", "")).strip()
        if text:
            text_parts.append(text)
        for word in segment.get("words") or []:
            try:
                ws = float(word.get("start", start)); we = float(word.get("end", end))
                if we > clip.start and ws < clip.end and str(word.get("word", "")).strip():
                    words.append(word)
            except (TypeError, ValueError):
                continue

    duration = max(0.1, float(clip.end) - float(clip.start))
    text = " ".join(text_parts).strip()
    word_count = len(words) if words else len(re.findall(r"\b[\wÀ-ÿ'-]+\b", text, re.UNICODE))
    wpm = word_count / duration * 60
    sentences = max(1, len(re.findall(r"[.!?]+", text)))
    words_per_sentence = word_count / sentences
    speech_density = min(100.0, (word_count / duration) / 3.2 * 100)
    breakdown = score_breakdown or {}
    viral_potential = max(0.0, min(100.0, float(clip.score)))
    return {
        "duration_seconds": round(duration, 2),
        "duration_label": f"{math.floor(duration // 60):02d}:{int(duration % 60):02d}",
        "word_count": int(word_count),
        "words_per_minute": round(wpm, 1),
        "sentence_count": int(sentences),
        "words_per_sentence": round(words_per_sentence, 1),
        "speech_density": round(speech_density, 1),
        "viral_potential": round(viral_potential, 1),
        "score_breakdown": {str(k): round(float(v), 1) for k, v in breakdown.items()},
    }
