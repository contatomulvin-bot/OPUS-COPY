import { GoogleGenAI, Type } from '@google/genai';
import { TranscriptSegmentDTO } from '../../transcription/transcription-provider';
import { AIClipItem, AIClipAnalyzerResultSchema } from '../../validation/schemas';
import { AIClipAnalyzer, AnalyzeTranscriptOptions } from '../ai-clip-analyzer';

export class GeminiClipAnalyzerProvider implements AIClipAnalyzer {
  private client: GoogleGenAI | null = null;

  private getClient(): GoogleGenAI {
    if (!this.client) {
      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey) {
        throw new Error('GEMINI_API_KEY não foi configurada no ambiente.');
      }
      this.client = new GoogleGenAI({
        apiKey,
        httpOptions: {
          headers: {
            'User-Agent': 'aistudio-build',
          },
        },
      });
    }
    return this.client;
  }

  async analyzeTranscript(
    segments: TranscriptSegmentDTO[],
    options: AnalyzeTranscriptOptions
  ): Promise<AIClipItem[]> {
    const ai = this.getClient();

    if (!segments || segments.length === 0) {
      throw new Error('Nenhum segmento de transcrição fornecido para análise.');
    }

    // Build structured transcript text with precise timestamps for Gemini
    const transcriptFormatted = segments
      .map(s => `[${s.startTime.toFixed(1)}s - ${s.endTime.toFixed(1)}s] ${s.text}`)
      .join('\n');

    const minDur = options.minDuration || 20;
    const maxDur = options.maxDuration || 90;
    const maxVideoDur = options.videoDuration || 3600;

    const systemInstruction = `Você é um editor sênior e estrategista especialista em Shorts/Reels/TikTok de altíssimo engajamento.
Sua missão é analisar a transcrição com timestamps de um vídeo longo e extrair os melhores candidatos a Shorts verticais autônomos.

DIRETRIZES FUNDAMENTAIS:
1. DURAÇÃO IDEAL: Cada clipe deve ter entre ${minDur}s e ${maxDur}s. Se o vídeo for mais curto que ${minDur}s, use o intervalo coerente disponível.
2. AUTONOMIA (CONTEXTO COMPLETO): O clipe deve fazer sentido completo por si só, sem precisar do restante do vídeo.
3. INÍCIO E FIM PERFEITOS:
   - Inicie exatamente onde o orador começa a frase ou ideia de impacto (HOOK imediato).
   - Termine exatamente onde a conclusão ou punchline é entregue.
   - NUNCA corte no meio de uma frase ou de uma palavra.
4. CRITÉRIOS DE AVALIAÇÃO (Score 0-100):
   - Hook inicial (primeiros 3 segundos prendem a atenção?)
   - Emoção, curiosidade, surpresa ou valor prático
   - Clareza da mensagem
   - Potencial de compartilhamento
5. NÃO invente momentos nem timestamps que não existam na transcrição.
6. O tempo final deve ser rigorosamente menor ou igual à duração do vídeo (${maxVideoDur.toFixed(1)}s).`;

    const prompt = `Analise a transcrição abaixo e extraia entre 3 a 6 dos melhores momentos para Shorts.

Título do Vídeo: ${options.videoTitle || 'Vídeo longo'}
Duração Total do Vídeo: ${maxVideoDur.toFixed(1)} segundos

TRANSCRIÇÃO COM TIMESTAMPS:
${transcriptFormatted}

Retorne um JSON com a lista de clipes encontrados, contendo startTime, endTime, title, hook, description, score (0-100) e subScores detalhados.`;

    try {
      const response = await ai.models.generateContent({
        model: 'gemini-3.7-flash',
        contents: prompt,
        config: {
          systemInstruction,
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              clips: {
                type: Type.ARRAY,
                description: 'Lista dos melhores momentos para Shorts',
                items: {
                  type: Type.OBJECT,
                  properties: {
                    startTime: {
                      type: Type.NUMBER,
                      description: 'Segundo inicial do corte',
                    },
                    endTime: {
                      type: Type.NUMBER,
                      description: 'Segundo final do corte',
                    },
                    title: {
                      type: Type.STRING,
                      description: 'Título curto e chamativo para o Short',
                    },
                    hook: {
                      type: Type.STRING,
                      description: 'Gancho ou motivo pelo qual esse momento prende a atenção',
                    },
                    description: {
                      type: Type.STRING,
                      description: 'Resumo conciso do conteúdo do clipe',
                    },
                    score: {
                      type: Type.INTEGER,
                      description: 'AI Potential Score de 0 a 100',
                    },
                    subScores: {
                      type: Type.OBJECT,
                      properties: {
                        hook: { type: Type.NUMBER },
                        clarity: { type: Type.NUMBER },
                        emotion: { type: Type.NUMBER },
                        standaloneContext: { type: Type.NUMBER },
                        curiosity: { type: Type.NUMBER },
                        shareability: { type: Type.NUMBER },
                      },
                    },
                  },
                  required: ['startTime', 'endTime', 'title', 'hook', 'description', 'score'],
                },
              },
            },
            required: ['clips'],
          },
        },
      });

      const rawJson = response.text?.trim() || '{}';
      const parsed = JSON.parse(rawJson);

      // Validate with Zod
      const validated = AIClipAnalyzerResultSchema.safeParse(parsed);
      if (!validated.success) {
        console.warn('Zod validation warning on AI clips, attempting correction:', validated.error.format());
        // Fallback filter
        const rawClips = Array.isArray(parsed.clips) ? parsed.clips : [];
        return rawClips
          .filter((c: any) => typeof c.startTime === 'number' && typeof c.endTime === 'number' && c.endTime > c.startTime)
          .map((c: any) => ({
            startTime: Math.max(0, Number(c.startTime)),
            endTime: Math.min(maxVideoDur, Number(c.endTime)),
            title: String(c.title || 'Melhor Momento').substring(0, 100),
            hook: String(c.hook || 'Momento de alto impacto').substring(0, 250),
            description: String(c.description || 'Trecho selecionado por IA').substring(0, 450),
            score: Math.min(100, Math.max(0, Math.round(Number(c.score) || 80))),
            subScores: c.subScores || {},
          }));
      }

      return validated.data.clips;
    } catch (err: any) {
      console.error('Error in Gemini Clip Analyzer:', err);
      throw new Error(`Falha na análise de melhores momentos com IA: ${err.message}`);
    }
  }
}
