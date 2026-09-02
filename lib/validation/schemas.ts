import { z } from 'zod';

export const CreateProjectSchema = z.object({
  name: z.string().min(1, 'Nome do projeto é obrigatório').max(100, 'Nome muito longo'),
});

export const ProcessVideoSchema = z.object({
  videoId: z.string().uuid('ID de vídeo inválido'),
  subtitleStyle: z.enum(['CLEAN', 'BOLD', 'DYNAMIC']).default('BOLD'),
  autoReframe: z.boolean().default(true),
});

export const YouTubeUrlSchema = z.object({
  url: z.string().url('URL inválida').refine((val) => {
    return /^(https?:\/\/)?(www\.)?(youtube\.com|youtu\.be)\/.+$/.test(val);
  }, 'Por favor, forneça uma URL válida do YouTube'),
  projectName: z.string().min(1).max(100).optional(),
});

export const UpdateClipSchema = z.object({
  startTime: z.number().nonnegative('Início não pode ser negativo'),
  endTime: z.number().positive('Fim deve ser maior que 0'),
  title: z.string().min(1).max(120).optional(),
  description: z.string().max(500).optional(),
  hook: z.string().max(250).optional(),
}).refine((data) => data.endTime > data.startTime, {
  message: 'O tempo final deve ser maior que o tempo inicial',
  path: ['endTime'],
});

export const RenderClipSchema = z.object({
  subtitleStyle: z.enum(['CLEAN', 'BOLD', 'DYNAMIC']).default('BOLD'),
  subtitlesEnabled: z.boolean().default(true),
  aspectRatio: z.enum(['9:16', '1:1', '16:9']).default('9:16'),
  reframeMode: z.enum(['CENTER_CROP', 'AUTO_TRACK', 'FIT_BLUR']).default('CENTER_CROP'),
});

// Zod schema for AI response parsing & validation
export const AIClipItemSchema = z.object({
  startTime: z.number().nonnegative('Timestamp inicial deve ser >= 0'),
  endTime: z.number().positive('Timestamp final deve ser > 0'),
  title: z.string().min(3, 'Título muito curto').max(120, 'Título muito longo'),
  hook: z.string().min(3, 'Hook muito curto').max(300, 'Hook muito longo'),
  description: z.string().min(5, 'Descrição muito curta').max(500, 'Descrição muito longa'),
  score: z.number().int().min(0, 'Score mínimo é 0').max(100, 'Score máximo é 100'),
  subScores: z.object({
    hook: z.number().min(0).max(100).optional(),
    clarity: z.number().min(0).max(100).optional(),
    emotion: z.number().min(0).max(100).optional(),
    standaloneContext: z.number().min(0).max(100).optional(),
    curiosity: z.number().min(0).max(100).optional(),
    shareability: z.number().min(0).max(100).optional(),
  }).optional(),
}).refine((val) => val.endTime > val.startTime + 5, {
  message: 'O clipe deve ter pelo menos 5 segundos de duração',
  path: ['endTime'],
});

export const AIClipAnalyzerResultSchema = z.object({
  clips: z.array(AIClipItemSchema),
  language: z.string().default('pt'),
  summary: z.string().optional(),
});

export type CreateProjectInput = z.infer<typeof CreateProjectSchema>;
export type ProcessVideoInput = z.infer<typeof ProcessVideoSchema>;
export type YouTubeUrlInput = z.infer<typeof YouTubeUrlSchema>;
export type UpdateClipInput = z.infer<typeof UpdateClipSchema>;
export type RenderClipInput = z.infer<typeof RenderClipSchema>;
export type AIClipItem = z.infer<typeof AIClipItemSchema>;
export type AIClipAnalyzerResult = z.infer<typeof AIClipAnalyzerResultSchema>;
