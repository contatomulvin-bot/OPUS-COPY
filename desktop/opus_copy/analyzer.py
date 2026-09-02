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
        raise ToolError(
            "Gemini indisponível (503) nos modelos configurados. "
            f"Último erro: {last_error}"
        ) from last_error

    def rank(self, transcript: dict, max_clips: int = 8) -> list[ClipCandidate]:
        segments = transcript.get("segments", [])
        if not segments:
            raise ToolError("A transcrição não contém segmentos.")

        compact = [
            {
                "start": round(float(s["start"]), 2),
                "end": round(float(s["end"]), 2),
                "text": s["text"],
            }
            for s in segments if s.get("text")
        ]

        prompt = f"""Você é o editor-chefe de YouTube Shorts e estrategista de audiência.

Sua tarefa é encontrar os momentos com maior potencial REAL de retenção, clique, descoberta e compartilhamento. O objetivo é maximizar a audiência sem inventar conteúdo.

PRIORIDADE DO RANKING:
- 30% força do GANCHO nos primeiros 3-5 segundos.
- 20% retenção potencial: existe uma pergunta, tensão, promessa, conflito ou curiosidade que faz continuar assistindo?
- 15% curiosidade/surpresa.
- 10% emoção ou identificação.
- 10% valor/entretenimento.
- 10% potencial de compartilhamento.
- 5% clareza e autonomia contextual.

REGRAS DE GANCHO:
- O início deve responder rapidamente: "por que eu deveria continuar assistindo?"
- Dê preferência a frases de impacto como perguntas fortes, revelações, contradições, números relevantes, opiniões fortes, histórias incomuns, erros, segredos, descobertas, antes/depois, consequências e promessas.
- NÃO force palavras chamativas quando elas não tiverem relação real com o conteúdo.
- NÃO transforme o vídeo em clickbait enganoso.
- O hook retornado deve ser baseado no que é dito no trecho. Pode ser uma formulação editorial curta, mas nunca pode inventar fatos.

PALAVRAS-CHAVE PARA YOUTUBE:
- Gere de 3 a 8 palavras-chave/frases curtas diretamente relacionadas ao assunto do clipe.
- Priorize termos que uma pessoa realmente pesquisaria no YouTube sobre aquele assunto.
- Misture termos amplos e específicos quando fizer sentido.
- Não use hashtags como palavras-chave.
- Não adicione palavras-chave só para parecer viral.

CONTEXTO E CORTE:
- O clipe precisa funcionar sozinho.
- Comece no início natural da ideia, mesmo que seja alguns segundos antes do trecho mais chamativo.
- Termine somente depois da conclusão, resposta ou punchline.
- Nunca corte uma frase no meio.
- Prefira 20-75 segundos, mas preserve uma ideia excelente se precisar de mais tempo.
- Não crie timestamps: use somente limites compatíveis com os segmentos fornecidos.

Retorne SOMENTE JSON válido:
{{"clips":[{{"start":0,"end":30,"score":0,"title":"...","hook":"...","reason":"...","category":"EDUCATION","keywords":["...","..."],"scores":{{"hook":0,"retention":0,"curiosity":0,"emotion":0,"value":0,"shareability":0,"clarity":0}}}}]}}

Categorias válidas: STORY, OPINION, EDUCATION, MOTIVATION, HUMOR, CONTROVERSY, SURPRISE, EMOTION, FACT, ADVICE, OTHER.

score é de 0 a 100 e deve refletir os critérios acima, não uma nota arbitrariamente alta. Máximo de {max_clips} clips.

TRANSCRIÇÃO:
{json.dumps(compact, ensure_ascii=False)}"""

        response = self._generate(prompt)
        text = getattr(response, "text", "") or ""
        match = re.search(r"\{{.*\}}", text, re.DOTALL)
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
            try:
                start = max(available_start, float(item["start"]))
                end = min(available_end, float(item["end"]))
                if end <= start or end - start < 8:
                    continue
                scores_raw = item.get("scores") if isinstance(item.get("scores"), dict) else {}
                scores = {
                    str(k): max(0.0, min(100.0, float(v)))
                    for k, v in scores_raw.items()
                    if isinstance(v, (int, float))
                }
                keywords = tuple(
                    str(k).strip() for k in item.get("keywords", [])
                    if str(k).strip()
                )[:8]
                result.append(ClipCandidate(
                    start=start,
                    end=end,
                    score=max(0.0, min(100.0, float(item.get("score", 0)))),
                    reason=str(item.get("reason", ""))[:500],
                    title=str(item.get("title", "Clip"))[:120],
                    hook=str(item.get("hook", ""))[:300],
                    keywords=keywords,
                    category=str(item.get("category", "OTHER")),
                    scores=scores,
                ))
            except (TypeError, ValueError, KeyError):
                continue

        return sorted(result, key=lambda c: c.score, reverse=True)[:max_clips]
