import { GoogleGenAI, Type } from "@google/genai";
import { env } from "./config.js";

export type TranscriptSegment = {
  start: number;
  end: number;
  text: string;
};

export type CloudClip = {
  start: number;
  end: number;
  score: number;
  reason: string;
  title: string;
  hook: string;
  keywords: string[];
  category: string;
  scores: Record<string, number>;
};

let aiClient: GoogleGenAI | null = null;

function getClient(): GoogleGenAI {
  if (!env.GEMINI_API_KEY) {
    throw new Error("GEMINI_API_KEY não configurada no MISTCUT Cloud.");
  }
  if (!aiClient) {
    aiClient = new GoogleGenAI({ apiKey: env.GEMINI_API_KEY });
  }
  return aiClient;
}

function chunkSegments(
  segments: TranscriptSegment[],
  maxDuration = 600,
  maxSegments = 150
): TranscriptSegment[][] {
  const chunks: TranscriptSegment[][] = [];
  let startIndex = 0;

  while (startIndex < segments.length) {
    const chunkStart = segments[startIndex].start;
    let endIndex = startIndex;

    while (endIndex < segments.length) {
      const next = segments[endIndex];
      if (
        endIndex > startIndex &&
        (next.end > chunkStart + maxDuration || endIndex - startIndex >= maxSegments)
      ) {
        break;
      }
      endIndex += 1;
    }

    if (endIndex === startIndex) endIndex += 1;
    chunks.push(segments.slice(startIndex, endIndex));
    startIndex = endIndex;
  }

  return chunks;
}

function promptFor(
  compact: TranscriptSegment[],
  maxClips: number,
  opening: boolean
): string {
  const openingRule = opening
    ? "ESTE É O BLOCO INICIAL DO VÍDEO. Avalie-o com a mesma atenção dos demais e procure um momento forte de abertura, promessa, conflito ou primeira revelação quando houver material válido.\n\n"
    : "";

  return `Você é o editor-chefe do MISTCUT e estrategista de audiência para YouTube Shorts, Reels e TikTok.

Encontre os momentos com maior potencial REAL de retenção, descoberta e compartilhamento, sem inventar conteúdo.

PESOS: 30% gancho nos primeiros 3-5s; 20% retenção; 15% curiosidade/surpresa; 10% emoção; 10% valor/entretenimento; 10% compartilhamento; 5% clareza/contexto.

REGRAS:
- o hook deve ser baseado no que realmente é dito;
- não faça clickbait enganoso;
- prefira perguntas, revelações, contradições, opiniões fortes, histórias incomuns, erros, consequências, descobertas e números relevantes;
- o clipe deve funcionar sozinho;
- comece no início natural da ideia e termine depois da conclusão;
- nunca corte frase;
- prefira 20-75 segundos;
- use SOMENTE timestamps existentes na transcrição.

${openingRule}
Retorne no máximo ${maxClips} clips distintos deste bloco.
Inclua 3-8 palavras-chave pesquisáveis, sem hashtags.

TRANSCRIÇÃO:
${JSON.stringify(compact)}`;
}

function normalizeClip(
  item: any,
  chunk: TranscriptSegment[]
): CloudClip | null {
  try {
    const minStart = Math.min(...chunk.map(s => s.start));
    const maxEnd = Math.max(...chunk.map(s => s.end));
    const start = Math.max(minStart, Number(item.start));
    const end = Math.min(maxEnd, Number(item.end));
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start || end - start < 8) {
      return null;
    }

    const allowed = new Set([
      "STORY",
      "OPINION",
      "EDUCATION",
      "MOTIVATION",
      "HUMOR",
      "CONTROVERSY",
      "SURPRISE",
      "EMOTION",
      "FACT",
      "ADVICE",
      "OTHER"
    ]);
    const category = String(item.category || "OTHER").toUpperCase();
    const scores: Record<string, number> = {};
    if (item.scores && typeof item.scores === "object") {
      for (const [key, value] of Object.entries(item.scores)) {
        const numeric = Number(value);
        if (Number.isFinite(numeric)) {
          scores[String(key)] = Math.max(0, Math.min(100, numeric));
        }
      }
    }

    return {
      start,
      end,
      score: Math.max(0, Math.min(100, Number(item.score) || 0)),
      reason: String(item.reason || "").slice(0, 500),
      title: String(item.title || "Clip").slice(0, 120),
      hook: String(item.hook || "").slice(0, 300),
      keywords: Array.isArray(item.keywords)
        ? item.keywords
            .map((value: unknown) => String(value).trim())
            .filter((value: string) => value && !value.startsWith("#"))
            .slice(0, 8)
        : [],
      category: allowed.has(category) ? category : "OTHER",
      scores
    };
  } catch {
    return null;
  }
}

async function generateChunk(
  chunk: TranscriptSegment[],
  maxClips: number,
  opening: boolean
): Promise<CloudClip[]> {
  const client = getClient();
  const models = [
    env.GEMINI_MODEL,
    ...env.GEMINI_FALLBACK_MODELS.split(",").map(v => v.trim()).filter(Boolean)
  ].filter((value, index, all) => all.indexOf(value) === index);

  let lastError: unknown = null;
  for (const model of models) {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const response = await client.models.generateContent({
          model,
          contents: promptFor(chunk, maxClips, opening),
          config: {
            responseMimeType: "application/json",
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                clips: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      start: { type: Type.NUMBER },
                      end: { type: Type.NUMBER },
                      score: { type: Type.NUMBER },
                      title: { type: Type.STRING },
                      hook: { type: Type.STRING },
                      reason: { type: Type.STRING },
                      category: { type: Type.STRING },
                      keywords: {
                        type: Type.ARRAY,
                        items: { type: Type.STRING }
                      },
                      scores: {
                        type: Type.OBJECT,
                        properties: {
                          hook: { type: Type.NUMBER },
                          retention: { type: Type.NUMBER },
                          curiosity: { type: Type.NUMBER },
                          emotion: { type: Type.NUMBER },
                          value: { type: Type.NUMBER },
                          shareability: { type: Type.NUMBER },
                          clarity: { type: Type.NUMBER }
                        }
                      }
                    },
                    required: ["start", "end", "score", "title", "hook", "reason"]
                  }
                }
              },
              required: ["clips"]
            }
          }
        });

        const parsed = JSON.parse(response.text?.trim() || "{}");
        const raw = Array.isArray(parsed.clips) ? parsed.clips : [];
        return raw
          .map((item: any) => normalizeClip(item, chunk))
          .filter((item: CloudClip | null): item is CloudClip => Boolean(item));
      } catch (error: any) {
        lastError = error;
        const status = error?.statusCode ?? error?.status ?? error?.code;
        const text = String(error?.message || error).toUpperCase();
        const transient =
          status === 429 ||
          status === 503 ||
          text.includes("429") ||
          text.includes("503") ||
          text.includes("UNAVAILABLE") ||
          text.includes("RESOURCE_EXHAUSTED");

        if (!transient) throw error;
        if (attempt < 2) {
          await new Promise(resolve => setTimeout(resolve, 1000 * Math.pow(2, attempt)));
        }
      }
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error("Gemini indisponível no momento.");
}

export async function analyzeTranscript(
  segments: TranscriptSegment[],
  maxClips: number
): Promise<CloudClip[]> {
  if (!segments.length) throw new Error("A transcrição não contém segmentos.");

  const compact = segments
    .map(segment => ({
      start: Number(segment.start),
      end: Number(segment.end),
      text: String(segment.text || "").trim()
    }))
    .filter(
      segment =>
        Number.isFinite(segment.start) &&
        Number.isFinite(segment.end) &&
        segment.end > segment.start &&
        segment.text
    );

  if (!compact.length) throw new Error("A transcrição não contém texto utilizável.");

  const requested = Math.max(1, Math.min(20, Math.trunc(maxClips)));
  const chunks = chunkSegments(compact);
  const perChunk = Math.max(1, Math.ceil(requested / chunks.length));
  const candidates: CloudClip[] = [];

  for (let index = 0; index < chunks.length; index += 1) {
    const limit = Math.min(
      4,
      perChunk + (index === 0 && chunks.length > 1 ? 1 : 0)
    );
    const found = await generateChunk(chunks[index], limit, index === 0);
    for (const candidate of found) {
      if (
        candidates.some(
          existing =>
            Math.abs(candidate.start - existing.start) < 4 &&
            Math.abs(candidate.end - existing.end) < 8
        )
      ) {
        continue;
      }
      candidates.push(candidate);
    }
  }

  if (!candidates.length) {
    throw new Error("A IA não encontrou clips válidos na transcrição.");
  }

  const ranked = [...candidates].sort((a, b) => b.score - a.score);
  const selected: CloudClip[] = [];
  const openingLimit = compact[0].start + 120;
  const opening = ranked
    .filter(candidate => candidate.start <= openingLimit)
    .sort((a, b) => b.score - a.score)[0];

  if (opening) selected.push(opening);

  for (const candidate of ranked) {
    if (selected.length >= requested) break;
    if (
      selected.some(
        existing =>
          Math.abs(candidate.start - existing.start) < 4 &&
          Math.abs(candidate.end - existing.end) < 8
      )
    ) {
      continue;
    }
    selected.push(candidate);
  }

  return selected.slice(0, requested);
}
