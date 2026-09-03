from __future__ import annotations

import json
import os
import re
import time
from dataclasses import dataclass

from .tools import ToolError


@dataclass(frozen=True)
class ClipCandidate:
    start: float
    end: float
    score: float
    reason: str
    title: str
    hook: str = ""
    keywords: tuple[str, ...] = ()
    category: str = "OTHER"
    scores: dict[str, float] | None = None


class ViralAnalyzer:
    """Ranks transcript moments for retention and YouTube audience potential."""

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
        fallback = os.getenv("GEMINI_FALLBACK_MODELS", "gemini-3.5-flash,gemini-3.5-flash-lite")
        self.models = list(dict.fromkeys([self.model, *[m.strip() for m in fallback.split(",") if m.strip()]]))

    def _generate(self, prompt: str):
        last_error: Exception | None = None
        for model in self.models:
            for attempt in range(3):
                try:
                    return self.client.models.generate_content(model=model, contents=prompt)
                except Exception as exc:
                    last_error = exc
                    status = getattr(exc, "status_code", None) or getattr(exc, "code", None)
                    text = str(exc).upper()
                    is_503 = status == 503 or "503" in text or "UNAVAILABLE" in text
                    if not is_503:
                        raise
                    if attempt < 2:
                        time.sleep(5 * (2 ** attempt))
        raise ToolError(f"Gemini indisponível (503) nos modelos configurados. Último erro: {last_error}") from last_error

    @staticmethod
    def _parse_payload(payload: dict, segments: list[dict], existing: list[ClipCandidate] | None = None) -> list[ClipCandidate]:
        available_start = min(float(s["start"]) for s in segments)
        available_end = max(float(s["end"]) for s in segments)
        result = list(existing or [])
        categories = {"STORY", "OPINION", "EDUCATION", "MOTIVATION", "HUMOR", "CONTROVERSY", "SURPRISE", "EMOTION", "FACT", "ADVICE", "OTHER"}
        for item in payload.get("clips", []):
            try:
                start = max(available_start, float(item["start"]))
                end = min(available_end, float(item["end"]))
                if end <= start or end - start < 8:
                    continue
                if any(abs(start - c.start) < 4 and abs(end - c.end) < 8 for c in result):
                    continue
                scores_raw = item.get("scores") if isinstance(item.get("scores"), dict) else {}
                scores = {str(k): max(0.0, min(100.0, float(v))) for k, v in scores_raw.items() if isinstance(v, (int, float))}
                keywords = tuple(str(k).strip() for k in item.get("keywords", []) if str(k).strip() and not str(k).strip().startswith("#"))[:8]
                category = str(item.get("category", "OTHER")).upper()
                if category not in categories:
                    category = "OTHER"
                result.append(ClipCandidate(
                    start=start, end=end,
                    score=max(0.0, min(100.0, float(item.get("score", 0)))),
                    reason=str(item.get("reason", ""))[:500],
                    title=str(item.get("title", "Clip"))[:120],
                    hook=str(item.get("hook", ""))[:300],
                    keywords=keywords, category=category, scores=scores,
                ))
            except (TypeError, ValueError, KeyError):
                continue
        return result

    @staticmethod
    def _extract_json(response) -> dict:
        text = getattr(response, "text", "") or ""
        match = re.search(r"\{.*\}", text, re.DOTALL)
        if not match:
            raise ToolError("A IA não retornou JSON de clips válido.")
        try:
            return json.loads(match.group(0))
        except json.JSONDecodeError as exc:
            raise ToolError(f"Resposta da IA não é JSON válido: {exc}") from exc

    @staticmethod
    def _chunk_segments(segments: list[dict], max_duration: float = 600.0, max_segments: int = 150) -> list[list[dict]]:
        """Split chronologically so Gemini cannot overlook the opening of long videos."""
        if not segments:
            return []
        chunks: list[list[dict]] = []
        start_index = 0
        while start_index < len(segments):
            chunk_start = float(segments[start_index]["start"])
            end_index = start_index
            while end_index < len(segments):
                next_segment = segments[end_index]
                if end_index > start_index and (
                    float(next_segment["end"]) > chunk_start + max_duration
                    or end_index - start_index >= max_segments
                ):
                    break
                end_index += 1
            if end_index == start_index:
                end_index = start_index + 1
            chunks.append(segments[start_index:end_index])
            start_index = end_index
        return chunks

    @staticmethod
    def _analysis_prompt(compact: list[dict], max_clips: int, opening: bool = False) -> str:
        opening_rule = (
            "ESTE É O BLOCO INICIAL DO VÍDEO. Você DEVE avaliá-lo com a mesma atenção dos demais blocos e procurar pelo menos um momento forte de abertura, introdução, promessa, conflito ou primeira revelação, quando houver material válido. Não pule este bloco.\n\n"
            if opening else ""
        )
        return f"""Você é o editor-chefe de YouTube Shorts e estrategista de audiência.

Encontre os momentos com maior potencial REAL de retenção, descoberta e compartilhamento. O objetivo é maximizar audiência sem inventar conteúdo.

PRIORIDADE: 30% gancho nos primeiros 3-5s; 20% retenção; 15% curiosidade/surpresa; 10% emoção; 10% valor/entretenimento; 10% compartilhamento; 5% clareza/contexto.

REGRAS: o hook deve ser baseado no que é dito; não faça clickbait enganoso; prefira perguntas, revelações, contradições, opiniões fortes, histórias incomuns, erros, consequências, descobertas e números relevantes; o clipe deve funcionar sozinho; comece no início natural da ideia e termine depois da conclusão; nunca corte frase; prefira 20-75s.

{opening_rule}Retorne no máximo {max_clips} clips distintos deste bloco. Use somente os timestamps existentes na transcrição. Não invente falas.

PALAVRAS-CHAVE: 3-8 termos/frases que alguém pesquisaria no YouTube, sem hashtags.

Retorne SOMENTE JSON válido:
{{"clips":[{{"start":0,"end":30,"score":0,"title":"...","hook":"...","reason":"...","category":"EDUCATION","keywords":["..."],"scores":{{"hook":0,"retention":0,"curiosity":0,"emotion":0,"value":0,"shareability":0,"clarity":0}}}}]}}

Categorias: STORY, OPINION, EDUCATION, MOTIVATION, HUMOR, CONTROVERSY, SURPRISE, EMOTION, FACT, ADVICE, OTHER.

TRANSCRIÇÃO DO BLOCO:
{json.dumps(compact, ensure_ascii=False)}"""

    def rank(self, transcript: dict, max_clips: int = 8) -> list[ClipCandidate]:
        segments = transcript.get("segments", [])
        if not segments:
            raise ToolError("A transcrição não contém segmentos.")
        max_clips = max(1, min(int(max_clips), 20))
        compact = [
            {"start": round(float(s["start"]), 2), "end": round(float(s["end"]), 2), "text": s["text"]}
            for s in segments if s.get("text")
        ]
        if not compact:
            raise ToolError("A transcrição não contém texto utilizável.")

        # Long transcripts are analysed chronologically in independent windows.
        # The first window is explicitly marked as the opening so the model cannot
        # effectively ignore the beginning while focusing on later high-signal text.
        chunks = self._chunk_segments(compact)
        raw_candidates: list[ClipCandidate] = []
        per_chunk = max(1, (max_clips + len(chunks) - 1) // len(chunks))

        for index, chunk in enumerate(chunks):
            # Give the opening block one extra slot so early moments have a fair chance.
            chunk_limit = min(4, per_chunk + (1 if index == 0 and len(chunks) > 1 else 0))
            prompt = self._analysis_prompt(chunk, chunk_limit, opening=index == 0)
            try:
                parsed = self._extract_json(self._generate(prompt))
                raw_candidates = self._parse_payload(parsed, chunk, raw_candidates)
            except ToolError:
                raise
            except Exception as exc:
                raise ToolError(f"Falha durante a análise do bloco {index + 1}/{len(chunks)}: {exc}") from exc

        if not raw_candidates:
            raise ToolError("A IA não encontrou clips válidos na transcrição.")

        # Prefer global quality, but guarantee that a strong opening candidate is not
        # discarded merely because later sections produced slightly higher scores.
        opening_candidates = [c for c in raw_candidates if c.start <= compact[0]["start"] + 120]
        ranked = sorted(raw_candidates, key=lambda c: c.score, reverse=True)
        selected: list[ClipCandidate] = []
        if opening_candidates and max_clips > 0:
            selected.append(max(opening_candidates, key=lambda c: c.score))
        for candidate in ranked:
            if len(selected) >= max_clips:
                break
            if any(abs(candidate.start - c.start) < 4 and abs(candidate.end - c.end) < 8 for c in selected):
                continue
            selected.append(candidate)

        # If an opening candidate was unavailable, fill purely by score.
        for candidate in ranked:
            if len(selected) >= max_clips:
                break
            if any(abs(candidate.start - c.start) < 4 and abs(candidate.end - c.end) < 8 for c in selected):
                continue
            selected.append(candidate)

        return sorted(selected[:max_clips], key=lambda c: c.score, reverse=True)
