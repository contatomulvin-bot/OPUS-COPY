import { z } from 'zod';

export interface TranscriptWordDTO {
  id?: string;
  word: string;
  startTime: number;
  endTime: number;
}

export interface TranscriptSegmentDTO {
  id?: string;
  startTime: number;
  endTime: number;
  text: string;
  words?: TranscriptWordDTO[];
}

export interface TranscriptionResult {
  language: string;
  text: string;
  segments: TranscriptSegmentDTO[];
}

export interface TranscriptionProvider {
  name: string;
  isAvailable(): Promise<boolean>;
  transcribe(audioPath: string, options?: { language?: string }): Promise<TranscriptionResult>;
}

// Zod validation schemas for transcription integrity
export const TranscriptWordSchema = z.object({
  id: z.string().optional(),
  word: z.string().min(1, 'Palavra não pode ser vazia'),
  startTime: z.number().gte(0, 'startTime não pode ser negativo').refine(n => !isNaN(n) && isFinite(n), 'startTime deve ser um número finito'),
  endTime: z.number().gt(0, 'endTime deve ser maior que zero').refine(n => !isNaN(n) && isFinite(n), 'endTime deve ser um número finito'),
}).refine(data => data.endTime >= data.startTime, {
  message: 'endTime deve ser maior ou igual a startTime para uma palavra',
  path: ['endTime'],
});

export const TranscriptSegmentSchema = z.object({
  id: z.string().optional(),
  startTime: z.number().gte(0, 'startTime não pode ser negativo').refine(n => !isNaN(n) && isFinite(n), 'startTime deve ser um número finito'),
  endTime: z.number().gt(0, 'endTime deve ser maior que zero').refine(n => !isNaN(n) && isFinite(n), 'endTime deve ser um número finito'),
  text: z.string().min(1, 'Texto do segmento não pode ser vazio'),
  words: z.array(TranscriptWordSchema).optional(),
}).refine(data => data.endTime > data.startTime, {
  message: 'endTime deve ser estritamente maior que startTime para um segmento',
  path: ['endTime'],
});

export const TranscriptionResultSchema = z.object({
  language: z.string().min(2, 'Código do idioma deve ter no mínimo 2 caracteres'),
  text: z.string().min(1, 'Texto da transcrição não pode ser vazio'),
  segments: z.array(TranscriptSegmentSchema).min(1, 'A transcrição deve conter pelo menos um segmento válido'),
});
