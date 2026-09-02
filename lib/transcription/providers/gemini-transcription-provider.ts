import { GoogleGenAI } from '@google/genai';
import fs from 'fs';
import path from 'path';
import {
  TranscriptionProvider,
  TranscriptionResult,
  TranscriptSegmentDTO,
  TranscriptWordDTO,
  TranscriptionResultSchema,
} from '../transcription-provider';

interface GeminiWordAnnotation {
  type?: string;
  text?: string;
  start_offset?: string;
  end_offset?: string;
  speaker?: string;
}

function parseOffset(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  const match = value.trim().match(/^([0-9]+(?:\.[0-9]+)?)s$/i);
  if (!match) return null;
  const seconds = Number(match[1]);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds : null;
}

function mimeTypeForAudio(audioPath: string): string {
  const ext = path.extname(audioPath).toLowerCase();
  const mimeTypes: Record<string, string> = {
    '.wav': 'audio/wav', '.mp3': 'audio/mp3', '.m4a': 'audio/m4a',
    '.aac': 'audio/aac', '.ogg': 'audio/ogg', '.opus': 'audio/opus',
    '.flac': 'audio/flac', '.aiff': 'audio/aiff', '.webm': 'audio/webm',
    '.mpeg': 'audio/mpeg',
  };
  return mimeTypes[ext] || 'audio/wav';
}

export class GeminiTranscriptionProvider implements TranscriptionProvider {
  name = 'Gemini 3.5 Transcribe';
  private client: GoogleGenAI | null = null;

  private getClient(): GoogleGenAI {
    if (!this.client) {
      const apiKey = process.env.GEMINI_API_KEY?.trim();
      if (!apiKey) {
        throw new Error('TRANSCRIPTION_UNAVAILABLE: GEMINI_API_KEY não foi configurada no ambiente.');
      }
      this.client = new GoogleGenAI({ apiKey });
    }
    return this.client;
  }

  async isAvailable(): Promise<boolean> {
    return Boolean(process.env.GEMINI_API_KEY?.trim());
  }

  async transcribe(audioPath: string, options?: { language?: string }): Promise<TranscriptionResult> {
    if (!fs.existsSync(audioPath)) throw new Error(`AUDIO_NOT_FOUND: Arquivo de áudio não encontrado para transcrição: ${audioPath}`);
    const stat = await fs.promises.stat(audioPath);
    if (stat.size === 0) throw new Error('AUDIO_NOT_FOUND: O arquivo de áudio está vazio.');

    const ai = this.getClient();
    const mimeType = mimeTypeForAudio(audioPath);

    try {
      const audioFile = await ai.files.upload({
        file: audioPath,
        config: { mimeType },
      });

      if (!audioFile.uri) throw new Error('TRANSCRIPTION_FAILED: A API Gemini não retornou uma URI para o arquivo de áudio.');

      const languageCode = options?.language?.trim();
      const generationConfig: Record<string, unknown> = {
        transcription_config: {
          ...(languageCode ? { language_codes: [languageCode] } : {}),
          mode: { type: 'verbatim', timestamp_granularities: ['word'] },
        },
      };

      const interaction: any = await ai.interactions.create({
        model: 'gemini-3.5-transcribe',
        input: [{ type: 'audio', uri: audioFile.uri, mime_type: audioFile.mimeType || mimeType }],
        generation_config: generationConfig,
      });

      const fullText = String(interaction.output_text || '').trim();
      const annotations: GeminiWordAnnotation[] = [];
      for (const step of interaction.steps ?? []) {
        for (const content of step.content ?? []) {
          for (const annotation of content.annotations ?? []) {
            if (annotation?.type === 'word_info') annotations.push(annotation as GeminiWordAnnotation);
          }
        }
      }

      if (!fullText || annotations.length === 0) throw new Error('INVALID_TRANSCRIPTION: O Gemini não retornou texto com timestamps de palavras.');

      const words: TranscriptWordDTO[] = [];
      for (const annotation of annotations) {
        const word = String(annotation.text || '').trim();
        const startTime = parseOffset(annotation.start_offset);
        const endTime = parseOffset(annotation.end_offset);
        if (!word || startTime === null || endTime === null || endTime <= startTime) continue;
        words.push({ word, startTime: Math.round(startTime * 100) / 100, endTime: Math.round(endTime * 100) / 100 });
      }
      if (words.length === 0) throw new Error('INVALID_TRANSCRIPTION: Nenhum timestamp de palavra válido foi retornado pelo Gemini.');

      const segments: TranscriptSegmentDTO[] = [];
      let currentWords: TranscriptWordDTO[] = [];
      const flushSegment = () => {
        if (!currentWords.length) return;
        segments.push({
          id: `seg-${segments.length + 1}`,
          startTime: currentWords[0].startTime,
          endTime: currentWords[currentWords.length - 1].endTime,
          text: currentWords.map(word => word.word).join(' ').trim(),
          words: [...currentWords],
        });
        currentWords = [];
      };

      for (let i = 0; i < words.length; i++) {
        const word = words[i];
        const previous = words[i - 1];
        currentWords.push(word);
        const pause = previous ? word.startTime - previous.endTime : 0;
        const textEndsSentence = /[.!?…]$/.test(word.word);
        const segmentDuration = word.endTime - currentWords[0].startTime;
        if (textEndsSentence || pause >= 0.9 || segmentDuration >= 8) flushSegment();
      }
      flushSegment();

      if (!segments.length) throw new Error('INVALID_TRANSCRIPTION: Não foi possível formar segmentos a partir dos timestamps.');

      const result: TranscriptionResult = { language: languageCode || 'pt', text: fullText, segments };
      const validated = TranscriptionResultSchema.safeParse(result);
      if (!validated.success) throw new Error(`INVALID_TRANSCRIPTION: Resultado incompatível com o esquema: ${validated.error.message}`);
      return validated.data;
    } catch (err: any) {
      console.error('Error during Gemini transcription:', err);
      if (/^(TRANSCRIPTION_|AUDIO_|INVALID_)/.test(err.message || '')) throw err;
      throw new Error(`TRANSCRIPTION_FAILED: ${err.message || 'Falha no processamento da transcrição'}`);
    }
  }
}

export const defaultTranscriptionProvider = new GeminiTranscriptionProvider();
