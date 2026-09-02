import { z } from 'zod';
import { CLIP_CATEGORIES, ClipCategory } from '../ai/prompts/clip-analysis-prompt';

export { CLIP_CATEGORIES };
export type { ClipCategory };

export interface ClipSubScores {
  hook: number;
  clarity: number;
  emotion: number;
  curiosity: number;
  standaloneContext: number;
  value: number;
}

export interface ClipCandidate {
  id?: string;
  startTime: number;
  endTime: number;
  title: string;
  hook: string;
  description: string;
  category: ClipCategory;
  score: number;
  scores: ClipSubScores;
  matchedText?: string;
}

export const ClipSubScoresSchema = z.object({
  hook: z.number().min(0).max(100),
  clarity: z.number().min(0).max(100),
  emotion: z.number().min(0).max(100),
  curiosity: z.number().min(0).max(100),
  standaloneContext: z.number().min(0).max(100),
  value: z.number().min(0).max(100),
});

export const ClipCandidateSchema = z.object({
  id: z.string().optional(),
  startTime: z.number().gte(0, 'startTime não pode ser negativo').refine(n => !isNaN(n) && isFinite(n), 'startTime deve ser um número finito'),
  endTime: z.number().gt(0, 'endTime deve ser maior que 0').refine(n => !isNaN(n) && isFinite(n), 'endTime deve ser um número finito'),
  title: z.string().min(1, 'Título não pode ser vazio').max(150, 'Título muito longo'),
  hook: z.string().min(1, 'Hook não pode ser vazio').max(300, 'Hook muito longo'),
  description: z.string().min(1, 'Descrição não pode ser vazia'),
  category: z.enum(CLIP_CATEGORIES),
  score: z.number().min(0).max(100),
  scores: ClipSubScoresSchema,
  matchedText: z.string().optional(),
}).refine(data => data.endTime > data.startTime, {
  message: 'endTime deve ser estritamente maior que startTime',
  path: ['endTime'],
});

export const ClipAnalysisResponseSchema = z.object({
  clips: z.array(ClipCandidateSchema).min(0),
});

export type ClipAnalysisResponse = z.infer<typeof ClipAnalysisResponseSchema>;
