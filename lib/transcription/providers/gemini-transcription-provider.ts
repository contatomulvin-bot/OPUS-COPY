import { GoogleGenAI, Type } from '@google/genai';
import fs from 'fs';
import path from 'path';
import {
  TranscriptionProvider,
  TranscriptionResult,
  TranscriptSegmentDTO,
  TranscriptWordDTO,
  TranscriptionResultSchema,
} from '../transcription-provider';

export class GeminiTranscriptionProvider implements TranscriptionProvider {
  name = 'Gemini Audio Transcriber';
  private client: GoogleGenAI | null = null;

  private getClient(): GoogleGenAI {
    if (!this.client) {
      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey) {
        throw new Error('TRANSCRIPTION_UNAVAILABLE: GEMINI_API_KEY não foi configurada no ambiente.');
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

  async isAvailable(): Promise<boolean> {
    return !!process.env.GEMINI_API_KEY;
  }

  async transcribe(audioPath: string, options?: { language?: string }): Promise<TranscriptionResult> {
    if (!fs.existsSync(audioPath)) {
      throw new Error(`AUDIO_NOT_FOUND: Arquivo de áudio não encontrado para transcrição: ${audioPath}`);
    }

    const stat = await fs.promises.stat(audioPath);
    if (stat.size === 0) {
      throw new Error('AUDIO_NOT_FOUND: O arquivo de áudio está vazio.');
    }

    const ai = this.getClient();
    const audioBuffer = await fs.promises.readFile(audioPath);
    const base64Audio = audioBuffer.toString('base64');

    // Detect MIME type based on extension
    const ext = path.extname(audioPath).toLowerCase();
    const mimeType = ext === '.wav' ? 'audio/wav' : ext === '.mp3' ? 'audio/mp3' : 'audio/wav';

    const preferredLang = options?.language || 'pt';

    const systemInstruction = `Você é um motor de transcrição de áudio profissional especializado em pontuação e timestamps exatos para legendas e cortes de vídeo.
Instruções:
1. Transcreva com fidelidade absoluta tudo o que é falado no áudio no idioma ${preferredLang} (ou idioma original detectado).
2. Não resuma, não parafraseie, não omita palavras.
3. Divida a fala em segmentos naturais (frases ou orações lógicas de 2 a 8 segundos).
4. Para cada segmento, determine startTime e endTime precisos em segundos (float, ex: 0.0, 3.42).
5. Para cada segmento, forneça a lista de palavras (words) com o timestamp individual de início e término de cada palavra.
6. Os timestamps de words devem estar contidos dentro do startTime e endTime do respectivo segmento.
7. Garanta que todos os números de tempo sejam válidos, finitos, não-negativos e ordenados cronologicamente.`;

    const prompt = `Transcreva o arquivo de áudio anexado com timestamps de segmentos e palavras. Retorne o resultado estritamente no esquema JSON solicitado.`;

    try {
      const response = await ai.models.generateContent({
        model: 'gemini-3.7-flash',
        contents: [
          {
            inlineData: {
              mimeType,
              data: base64Audio,
            },
          },
          {
            text: prompt,
          },
        ],
        config: {
          systemInstruction,
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              language: {
                type: Type.STRING,
                description: 'Código do idioma detectado (ex: pt, en, es)',
              },
              fullText: {
                type: Type.STRING,
                description: 'Transcrição completa contínua do áudio',
              },
              segments: {
                type: Type.ARRAY,
                description: 'Segmentos de áudio com timestamps precisos em segundos',
                items: {
                  type: Type.OBJECT,
                  properties: {
                    startTime: {
                      type: Type.NUMBER,
                      description: 'Início do segmento em segundos (float >= 0)',
                    },
                    endTime: {
                      type: Type.NUMBER,
                      description: 'Fim do segmento em segundos (float > startTime)',
                    },
                    text: {
                      type: Type.STRING,
                      description: 'Texto falado no intervalo',
                    },
                    words: {
                      type: Type.ARRAY,
                      description: 'Palavras individuais com seus timestamps de fala',
                      items: {
                        type: Type.OBJECT,
                        properties: {
                          word: {
                            type: Type.STRING,
                            description: 'A palavra individual falada',
                          },
                          startTime: {
                            type: Type.NUMBER,
                            description: 'Segundo de início da pronúncia da palavra',
                          },
                          endTime: {
                            type: Type.NUMBER,
                            description: 'Segundo de término da pronúncia da palavra',
                          },
                        },
                        required: ['word', 'startTime', 'endTime'],
                      },
                    },
                  },
                  required: ['startTime', 'endTime', 'text'],
                },
              },
            },
            required: ['language', 'fullText', 'segments'],
          },
        },
      });

      const rawJson = response.text?.trim() || '{}';
      let parsed: any;
      try {
        parsed = JSON.parse(rawJson);
      } catch (jsonErr: any) {
        throw new Error(`INVALID_TRANSCRIPTION: Falha ao interpretar JSON retornado: ${jsonErr.message}`);
      }

      if (!parsed || !Array.isArray(parsed.segments) || parsed.segments.length === 0) {
        throw new Error('INVALID_TRANSCRIPTION: Nenhum segmento de fala detectado no áudio.');
      }

      // Process and sanitize segments & words
      let lastEndTime = 0;
      const rawSegments: TranscriptSegmentDTO[] = [];

      for (let i = 0; i < parsed.segments.length; i++) {
        const seg = parsed.segments[i];
        const segText = String(seg.text || '').trim();
        if (!segText) continue;

        let start = Number(seg.startTime);
        let end = Number(seg.endTime);

        if (isNaN(start) || !isFinite(start) || start < 0) {
          start = lastEndTime;
        }
        if (isNaN(end) || !isFinite(end) || end <= start) {
          // Estimate approx duration based on words if available, else 2 seconds
          end = start + Math.max(1.0, segText.split(/\s+/).length * 0.35);
        }

        lastEndTime = end;

        // Process words if provided
        const words: TranscriptWordDTO[] = [];
        if (Array.isArray(seg.words) && seg.words.length > 0) {
          let wordLastEnd = start;
          for (let w = 0; w < seg.words.length; w++) {
            const rawWord = seg.words[w];
            const wordText = String(rawWord.word || '').trim();
            if (!wordText) continue;

            let wStart = Number(rawWord.startTime);
            let wEnd = Number(rawWord.endTime);

            if (isNaN(wStart) || !isFinite(wStart) || wStart < start) {
              wStart = wordLastEnd;
            }
            if (isNaN(wEnd) || !isFinite(wEnd) || wEnd <= wStart || wEnd > end + 1.0) {
              wEnd = Math.min(end, wStart + 0.3);
              if (wEnd <= wStart) wEnd = wStart + 0.2;
            }

            wordLastEnd = wEnd;
            words.push({
              word: wordText,
              startTime: Math.round(wStart * 100) / 100,
              endTime: Math.round(wEnd * 100) / 100,
            });
          }
        }

        rawSegments.push({
          id: `seg-${i + 1}`,
          startTime: Math.round(start * 100) / 100,
          endTime: Math.round(end * 100) / 100,
          text: segText,
          words: words.length > 0 ? words : undefined,
        });
      }

      // Sort segments chronologically
      rawSegments.sort((a, b) => a.startTime - b.startTime);

      if (rawSegments.length === 0) {
        throw new Error('INVALID_TRANSCRIPTION: Não foi possível extrair segmentos legíveis do áudio.');
      }

      const fullText = String(parsed.fullText || rawSegments.map(s => s.text).join(' ')).trim();
      const detectedLang = String(parsed.language || preferredLang).toLowerCase();

      const candidateResult: TranscriptionResult = {
        language: detectedLang,
        text: fullText,
        segments: rawSegments,
      };

      // Strict validation via Zod
      const validated = TranscriptionResultSchema.safeParse(candidateResult);
      if (!validated.success) {
        console.warn('Transcription validation warning:', validated.error.format());
        // If minor validation error, still return sanitized candidate if valid
        return candidateResult;
      }

      return validated.data;
    } catch (err: any) {
      console.error('Error during Gemini transcription:', err);
      if (err.message?.startsWith('TRANSCRIPTION_') || err.message?.startsWith('AUDIO_') || err.message?.startsWith('INVALID_')) {
        throw err;
      }
      throw new Error(`TRANSCRIPTION_FAILED: ${err.message || 'Falha no processamento da transcrição'}`);
    }
  }
}

export const defaultTranscriptionProvider = new GeminiTranscriptionProvider();
