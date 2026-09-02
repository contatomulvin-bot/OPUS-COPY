import fs from 'fs';
import path from 'path';
import { prisma } from '../db/prisma';
import {
  RenderOptions,
  RenderOptionsSchema,
  RENDER_ERRORS,
  VideoMetadata,
} from '../video/types';
import { defaultVideoProcessor, VideoProcessor } from '../video/video-processor';
import { defaultCaptionSegmenter, CaptionSegmenter } from '../video/subtitles/caption-segmenter';
import { defaultSubtitleGenerator, SubtitleGenerator } from '../video/subtitles/subtitle-generator';
import { serializePrisma } from '../utils/serializer';

export class RenderService {
  private videoProcessor: VideoProcessor;
  private captionSegmenter: CaptionSegmenter;
  private subtitleGenerator: SubtitleGenerator;

  constructor(
    videoProcessor: VideoProcessor = defaultVideoProcessor,
    captionSegmenter: CaptionSegmenter = defaultCaptionSegmenter,
    subtitleGenerator: SubtitleGenerator = defaultSubtitleGenerator
  ) {
    this.videoProcessor = videoProcessor;
    this.captionSegmenter = captionSegmenter;
    this.subtitleGenerator = subtitleGenerator;
  }

  /**
   * Valida o clipe e cria o registro de Render no banco de dados
   */
  async createRender(clipId: string, options: Partial<RenderOptions> = {}) {
    const validOptions = RenderOptionsSchema.parse(options);

    const clip = await prisma.clip.findUnique({
      where: { id: clipId },
      include: {
        video: {
          include: {
            transcript: true,
          },
        },
      },
    });

    if (!clip) {
      throw new Error(`${RENDER_ERRORS.INVALID_CLIP_TIMESTAMPS}: Clip não encontrado (id: ${clipId}).`);
    }

    // Validações rigorosas de timestamps
    if (clip.startTime < 0) {
      throw new Error(`${RENDER_ERRORS.INVALID_CLIP_TIMESTAMPS}: startTime não pode ser negativo (${clip.startTime}).`);
    }

    if (clip.endTime <= clip.startTime) {
      throw new Error(
        `${RENDER_ERRORS.INVALID_CLIP_TIMESTAMPS}: endTime (${clip.endTime}) deve ser estritamente maior que startTime (${clip.startTime}).`
      );
    }

    if (clip.video.duration > 0 && clip.endTime > clip.video.duration + 2.0) {
      throw new Error(
        `${RENDER_ERRORS.INVALID_CLIP_TIMESTAMPS}: endTime (${clip.endTime}s) excede a duração do vídeo (${clip.video.duration}s).`
      );
    }

    // Se legendas foram exigidas, checar se há transcrição
    if (validOptions.captionsEnabled && !clip.video.transcript) {
      throw new Error(
        `${RENDER_ERRORS.TRANSCRIPT_REQUIRED_FOR_CAPTIONS}: Este vídeo não possui transcrição disponível para gerar legendas. Desative legendas ou transcreva o vídeo primeiro.`
      );
    }

    // Criar o registro de Render
    const render = await prisma.render.create({
      data: {
        clipId,
        status: 'QUEUED',
        options: JSON.stringify(validOptions),
        progress: 0,
        currentStep: 'Render agendado na fila de processamento',
        errorMessage: null,
      },
    });

    return serializePrisma(render);
  }

  /**
   * Executa a renderização física e real do Short em MP4 vertical
   */
  async processRender(renderId: string) {
    const render = await prisma.render.findUnique({
      where: { id: renderId },
      include: {
        clip: {
          include: {
            video: {
              include: {
                transcript: {
                  include: {
                    segments: {
                      include: { words: true },
                      orderBy: { startTime: 'asc' },
                    },
                  },
                },
              },
            },
          },
        },
      },
    });

    if (!render) {
      throw new Error(`${RENDER_ERRORS.RENDER_NOT_FOUND}: Render não encontrado (${renderId}).`);
    }

    const { clip } = render;
    const { video } = clip;

    // Atualizar status para PROCESSING
    await prisma.render.update({
      where: { id: renderId },
      data: {
        status: 'PROCESSING',
        progress: 10,
        currentStep: 'Validando vídeo de origem no sistema de arquivos...',
        errorMessage: null,
      },
    });

    await prisma.clip.update({
      where: { id: clip.id },
      data: { status: 'RENDERING' },
    });

    try {
      // 1. Localizar arquivo de vídeo de origem
      const sourcePath = path.isAbsolute(video.storagePath)
        ? video.storagePath
        : path.join(process.cwd(), video.storagePath);

      if (!fs.existsSync(sourcePath)) {
        throw new Error(
          `${RENDER_ERRORS.SOURCE_VIDEO_NOT_FOUND}: Arquivo de vídeo original não encontrado em ${sourcePath}`
        );
      }

      // Parse das opções
      let options: RenderOptions = RenderOptionsSchema.parse({});
      if (render.options) {
        try {
          options = RenderOptionsSchema.parse(JSON.parse(render.options));
        } catch {
          options = RenderOptionsSchema.parse({});
        }
      }

      // 2. Preparar legendas se habilitadas
      let subtitlesAssPath: string | undefined;
      const subtitlesDir = path.join(process.cwd(), 'storage', 'subtitles');
      if (!fs.existsSync(subtitlesDir)) {
        fs.mkdirSync(subtitlesDir, { recursive: true });
      }

      if (options.captionsEnabled) {
        await prisma.render.update({
          where: { id: renderId },
          data: {
            progress: 25,
            currentStep: 'Segmentando palavras e gerando arquivo de legendas estilizadas...',
          },
        });

        const segments = video.transcript?.segments || [];
        if (segments.length === 0) {
          throw new Error(
            `${RENDER_ERRORS.TRANSCRIPT_REQUIRED_FOR_CAPTIONS}: Nenhuma palavra ou segmento de transcrição disponível para o clipe.`
          );
        }

        // Gerar captions agrupadas para a janela do clipe
        const captions = this.captionSegmenter.segment(segments, {
          clipStartTime: clip.startTime,
          clipEndTime: clip.endTime,
          relativeToClipStart: true,
          minWordsPerCaption: 2,
          maxWordsPerCaption: 5,
        });

        if (captions.length > 0) {
          const files = await this.subtitleGenerator.saveSubtitleFiles(
            clip.id,
            captions,
            options.captionStyle,
            subtitlesDir
          );
          subtitlesAssPath = files.assPath;
        }
      }

      // 3. Definir caminho de saída seguro
      const rendersDir = path.join(process.cwd(), 'storage', 'renders');
      if (!fs.existsSync(rendersDir)) {
        fs.mkdirSync(rendersDir, { recursive: true });
      }

      const outputFileName = `${renderId}.mp4`;
      const outputAbsPath = path.join(rendersDir, outputFileName);
      const logicalPath = `storage/renders/${outputFileName}`;

      await prisma.render.update({
        where: { id: renderId },
        data: {
          progress: 40,
          currentStep: 'Renderizando Short 9:16 (1080x1920) com FFmpeg...',
        },
      });

      // 4. Executar FFmpeg para corte e conversão 9:16
      await this.videoProcessor.renderVertical({
        inputVideoPath: sourcePath,
        outputVideoPath: outputAbsPath,
        startTime: clip.startTime,
        endTime: clip.endTime,
        subtitlesPath: subtitlesAssPath,
        subtitlesEnabled: options.captionsEnabled && !!subtitlesAssPath,
        subtitleStyle: options.captionStyle,
        reframeMode: options.reframeMode,
        targetWidth: options.width,
        targetHeight: options.height,
        quality: options.quality,
        onProgress: async (percent) => {
          // Normaliza progresso FFmpeg entre 40% e 85%
          const normalized = Math.min(85, Math.max(40, 40 + Math.round((percent / 100) * 45)));
          await prisma.render.update({
            where: { id: renderId },
            data: {
              progress: normalized,
              currentStep: `Renderizando MP4: ${percent}% processado...`,
            },
          }).catch(() => {});
        },
      });

      // 5. Validar arquivo final com ffprobe
      await prisma.render.update({
        where: { id: renderId },
        data: {
          progress: 90,
          currentStep: 'Validando conformidade do MP4 e resolução com ffprobe...',
        },
      });

      const validation = await this.videoProcessor.validateOutput(
        outputAbsPath,
        clip.endTime - clip.startTime,
        { minWidth: options.width, minHeight: options.height }
      );

      if (!validation.isValid) {
        throw new Error(validation.error || `${RENDER_ERRORS.OUTPUT_INVALID}: Arquivo MP4 gerado não passou na validação.`);
      }

      // 6. Atualizar estado final com sucesso
      const updatedRender = await prisma.render.update({
        where: { id: renderId },
        data: {
          status: 'COMPLETED',
          progress: 100,
          outputPath: logicalPath,
          currentStep: 'Short renderizado e pronto para visualização e download.',
          errorMessage: null,
          completedAt: new Date(),
        },
      });

      await prisma.clip.update({
        where: { id: clip.id },
        data: { status: 'COMPLETED' },
      });

      return serializePrisma(updatedRender);
    } catch (err: any) {
      console.error(`Erro durante renderização ${renderId}:`, err);
      const errorMessage = err.message || 'Falha desconhecida durante a renderização do Short.';

      const failedRender = await prisma.render.update({
        where: { id: renderId },
        data: {
          status: 'FAILED',
          progress: 0,
          errorMessage,
          currentStep: 'Falha na renderização do Short.',
        },
      });

      await prisma.clip.update({
        where: { id: clip.id },
        data: { status: 'FAILED' },
      });

      throw err;
    }
  }

  /**
   * Consulta status de um render
   */
  async getRender(renderId: string) {
    const render = await prisma.render.findUnique({
      where: { id: renderId },
      include: {
        clip: {
          include: {
            video: true,
          },
        },
      },
    });

    if (!render) {
      throw new Error(`${RENDER_ERRORS.RENDER_NOT_FOUND}: Render não encontrado (${renderId}).`);
    }

    return serializePrisma(render);
  }

  /**
   * Reexecuta um render que falhou
   */
  async retryRender(renderId: string) {
    const render = await prisma.render.findUnique({
      where: { id: renderId },
    });

    if (!render) {
      throw new Error(`${RENDER_ERRORS.RENDER_NOT_FOUND}: Render não encontrado (${renderId}).`);
    }

    // Resetar estado do render
    await prisma.render.update({
      where: { id: renderId },
      data: {
        status: 'QUEUED',
        progress: 0,
        errorMessage: null,
        currentStep: 'Reiniciando renderização...',
      },
    });

    return this.processRender(renderId);
  }

  /**
   * Renderização em lote de todos os clipes com status 'SELECTED' em um projeto
   */
  async batchRenderSelected(projectId: string, options: Partial<RenderOptions> = {}) {
    const clips = await prisma.clip.findMany({
      where: {
        status: 'SELECTED',
        video: { projectId },
      },
    });

    if (clips.length === 0) {
      return {
        total: 0,
        queued: 0,
        rendered: 0,
        failed: 0,
        results: [],
        message: 'Nenhum clipe com status SELECTED encontrado no projeto.',
      };
    }

    const results: Array<{ clipId: string; renderId?: string; status: string; error?: string }> = [];
    let queued = 0;
    let rendered = 0;
    let failed = 0;

    for (const clip of clips) {
      try {
        const render = await this.createRender(clip.id, options);
        queued++;

        // Processar de forma assíncrona ou sequencial
        try {
          await this.processRender(render.id);
          rendered++;
          results.push({
            clipId: clip.id,
            renderId: render.id,
            status: 'COMPLETED',
          });
        } catch (processErr: any) {
          failed++;
          results.push({
            clipId: clip.id,
            renderId: render.id,
            status: 'FAILED',
            error: processErr.message,
          });
        }
      } catch (err: any) {
        failed++;
        results.push({
          clipId: clip.id,
          status: 'FAILED',
          error: err.message,
        });
      }
    }

    return {
      total: clips.length,
      queued,
      rendered,
      failed,
      results,
    };
  }
}

export const defaultRenderService = new RenderService();
