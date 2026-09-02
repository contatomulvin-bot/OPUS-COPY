from __future__ import annotations

import json
import os
import re
from dataclasses import dataclass

from .tools import ToolError


@dataclass(frozen=True)
class ClipCandidate:
    start: float
    end: float
    score: float
    reason: str
    title: str


class ViralAnalyzer:
    """Uses Gemini to rank transcript windows; it never invents timestamps outside the transcript."""

    def __init__(self) -> None:
        try:
            from google import genai  # type: ignore
        except ImportError as exc:
            raise ToolError("google-genai não está instalado.") from exc
        api_key = os.getenv("GEMINI_API_KEY")
        if not api_key:
            raise ToolError("GEMINI_API_KEY não configurada.")
        self.client = genai.Client(api_key=api_key)
        self.model = os.getenv("GEMINI_MODEL", "gemini-3.6-flash")

    def rank(self, transcript: dict, max_clips: int = 8) -> list[ClipCandidate]:
        segments = transcript.get("segments", [])
        if not segments:
            raise ToolError("A transcrição não contém segmentos.")

        compact = [
            {"start": round(float(s["start"]), 2), "end": round(float(s["end"]), 2), "text": s["text"]}
            for s in segments if s.get("text")
        ]
        prompt = f"""Você é o editor-chefe de vídeos curtos. Analise a transcrição abaixo e encontre os momentos com maior potencial de retenção/viralização para TikTok, Reels e Shorts.

Critérios: hook nos primeiros segundos, emoção/opinião forte, surpresa, conflito, curiosidade, valor prático, frase memorável e contexto suficiente para funcionar fora do vídeo original. Prefira trechos de 20 a 75 segundos e evite começar no meio de uma frase. Não escolha momentos apenas porque têm palavras chamativas.

Retorne SOMENTE JSON válido neste formato:
{{"clips":[{{"start":0,"end":30,"score":0,"title":"...","reason":"..."}}]}}

score deve ser de 0 a 100. Os timestamps DEVEM corresponder aos segmentos fornecidos e estar dentro do intervalo disponível. Máximo de {max_clips} clips. Não crie fatos que não estejam no texto.

TRANSCRIÇÃO:
{json.dumps(compact, ensure_ascii=False)}"""

        response = self.client.models.generate_content(model=self.model, contents=prompt)
        text = getattr(response, "text", "") or ""
        match = re.search(r"\{.*\}", text, re.DOTALL)
        if not match:
            raise ToolError("A IA não retornou JSON de clips válido.")
        try:
            payload = json.loads(match.group(0))
        except json.JSONDecodeError as exc:
            raise ToolError(f"Resposta da IA não é JSON válido: {exc}") from exc

        available_start = min(float(s["start"]) for s in segments)
        available_end = max(float(s["end"]) for s in segments)
        result: list[ClipCandidate] = []
        for item in payload.get("clips", []):
            start = max(available_start, float(item["start"]))
            end = min(available_end, float(item["end"]))
            if end <= start or end - start < 8:
                continue
            result.append(ClipCandidate(start, end, max(0, min(100, float(item["score"]))), str(item.get("reason", "")), str(item.get("title", "Clip"))))
        return sorted(result, key=lambda c: c.score, reverse=True)[:max_clips]
