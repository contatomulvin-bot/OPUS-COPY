import { prisma } from '../db/prisma';
import { ClipCandidate, ClipCategory } from '../clips/types';
import { ClipAnalyzer, defaultClipAnalyzer } from '../clips/clip-analyzer';
import { serializePrisma } from '../utils/serializer';

export interface AnalyzeVideoOptions {
  force?: boolean;
  maxCandidates?: number;
  minClipDuration?: number;
  maxClipDuration?: number;
}

export interface UpdateClipInput {
  title?: string;
  startTime?: number;
  endTime?: number;
  status?: 'CANDIDATE' | 'SELECTED' | 'RENDERING' | 'COMPLETED' | 'FAILED';
}

export class ClipService {
  private analyzer: ClipAnalyzer;

  constructor(analyzer: ClipAnalyzer = defaultClipAnalyzer) {
    this.analyzer = analyzer;
  }

  /**
   * Executa a análise inteligente da transcrição e gera candidatos a Shorts salvos no banco
   */
  async analyzeVideo(videoId: string, options: AnalyzeVideoOptions = {}) {
    const video = await prisma.video.findUnique({
      where: { id: videoId },
      include: {
        project: true,
        clips: {
          orderBy: { score: 'desc' },
        },
        transcript: {
          include: {
            segments: {
              include: { words: true },
              orderBy: { startTime: 'asc' },
            },
          },
        },
      },
    });

    if (!video) {
      throw new Error('VIDEO_NOT_FOUND: Vídeo não encontrado.');
    }

    if (!video.transcript || video.transcript.segments.length === 0) {
      throw new Error('TRANSCRIPT_NOT_FOUND: Este vídeo ainda não possui uma transcrição concluída para análise.');
    }

    // Se já tiver clips e não for solicitada re-análise forçada, retorna os clips existentes
    if (video.clips && video.clips.length > 0 && !options.force) {
      return {
        cached: true,
        clips: serializePrisma(video.clips),
      };
    }

    // Atualizar status do vídeo para ANALYZING
    await prisma.video.update({
      where: { id: videoId },
      data: {
        status: 'ANALYZING',
        progress: 90,
        currentStep: 'Identificando ganchos virais e melhores momentos com IA...',
        errorMessage: null,
      },
    });

    try {
      // Executar análise semântica
      const candidates = await this.analyzer.analyzeTranscript(video.transcript.segments, {
        videoTitle: video.originalName || video.project?.name,
        videoDuration: video.duration || undefined,
        maxCandidates: options.maxCandidates || 8,
        minClipDuration: options.minClipDuration || 20,
        maxClipDuration: options.maxClipDuration || 90,
      });

      if (!candidates || candidates.length === 0) {
        throw new Error('NO_CLIPS_FOUND: Nenhum momento relevante pôde ser extraído da transcrição.');
      }

      // Persistir clips em transação Prisma de forma atômica
      const savedClips = await prisma.$transaction(async (tx) => {
        // Excluir clips anteriores se force=true
        if (options.force) {
          await tx.clip.deleteMany({
            where: { videoId },
          });
        }

        // Inserir cada candidato
        for (const c of candidates) {
          await tx.clip.create({
            data: {
              videoId,
              startTime: c.startTime,
              endTime: c.endTime,
              title: c.title,
              description: c.description,
              hook: c.hook,
              category: c.category,
              score: c.score,
              scores: JSON.stringify(c.scores),
              status: 'CANDIDATE',
            },
          });
        }

        // Atualizar status do vídeo para ANALYZED
        await tx.video.update({
          where: { id: videoId },
          data: {
            status: 'ANALYZED',
            progress: 100,
            currentStep: `${candidates.length} melhores momentos identificados com sucesso.`,
            errorMessage: null,
          },
        });

        // Buscar todos os clips criados
        return tx.clip.findMany({
          where: { videoId },
          orderBy: { score: 'desc' },
        });
      });

      return {
        cached: false,
        clips: serializePrisma(savedClips),
      };
    } catch (err: any) {
      console.error(`Erro durante análise do vídeo ${videoId}:`, err);
      const errorMessage = err.message || 'Falha ao analisar os melhores momentos do vídeo.';

      await prisma.video.update({
        where: { id: videoId },
        data: {
          status: 'FAILED',
          errorMessage,
          currentStep: 'Falha durante a análise de cortes com IA.',
        },
      });

      throw err;
    }
  }

  /**
   * Busca todos os clips de um vídeo
   */
  async getVideoClips(videoId: string) {
    const clips = await prisma.clip.findMany({
      where: { videoId },
      orderBy: { score: 'desc' },
    });

    return serializePrisma(clips);
  }

  /**
   * Atualiza informações ou timestamps de um clip após validação
   */
  async updateClip(clipId: string, input: UpdateClipInput) {
    const existing = await prisma.clip.findUnique({
      where: { id: clipId },
      include: { video: true },
    });

    if (!existing) {
      throw new Error('CLIP_NOT_FOUND: Clip não encontrado.');
    }

    const dataToUpdate: any = {};

    if (input.title !== undefined) {
      const cleanTitle = input.title.trim();
      if (!cleanTitle) {
        throw new Error('INVALID_CLIP: O título não pode ser vazio.');
      }
      dataToUpdate.title = cleanTitle;
    }

    let start = input.startTime !== undefined ? Number(input.startTime) : existing.startTime;
    let end = input.endTime !== undefined ? Number(input.endTime) : existing.endTime;

    if (isNaN(start) || start < 0) {
      throw new Error('INVALID_CLIP: startTime inválido ou negativo.');
    }

    if (isNaN(end) || end <= start) {
      throw new Error('INVALID_CLIP: endTime deve ser estritamente maior que startTime.');
    }

    if (existing.video?.duration && end > existing.video.duration + 2.0) {
      throw new Error(`INVALID_CLIP: endTime (${end}s) excede a duração total do vídeo (${existing.video.duration}s).`);
    }

    if (input.startTime !== undefined) dataToUpdate.startTime = Math.round(start * 100) / 100;
    if (input.endTime !== undefined) dataToUpdate.endTime = Math.round(end * 100) / 100;
    if (input.status) dataToUpdate.status = input.status;

    const updated = await prisma.clip.update({
      where: { id: clipId },
      data: dataToUpdate,
    });

    return serializePrisma(updated);
  }

  /**
   * Alterna seleção de um clip
   */
  async toggleSelectClip(clipId: string) {
    const clip = await prisma.clip.findUnique({ where: { id: clipId } });
    if (!clip) {
      throw new Error('CLIP_NOT_FOUND: Clip não encontrado.');
    }

    const newStatus = clip.status === 'SELECTED' ? 'CANDIDATE' : 'SELECTED';
    const updated = await prisma.clip.update({
      where: { id: clipId },
      data: { status: newStatus },
    });

    return serializePrisma(updated);
  }
}

export const defaultClipService = new ClipService();
