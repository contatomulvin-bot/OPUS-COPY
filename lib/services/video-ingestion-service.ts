import fs from 'fs';
import path from 'path';
import { prisma } from '../db/prisma';
import { StorageProvider } from '../storage/storage-provider';
import { defaultStorage } from '../storage/providers/local-storage-provider';
import { VideoProcessor, FFmpegVideoProcessor, defaultVideoProcessor } from '../video/video-processor';
import { UploadSourceProvider, UploadedFileInfo } from '../video/providers/upload-provider';
import { YouTubeProvider } from '../video/providers/youtube-provider';
import { serializePrisma } from '../utils/serializer';

export interface IngestionOptions {
  autoExtractAudio?: boolean;
}

export class VideoIngestionService {
  private storage: StorageProvider;
  private videoProcessor: VideoProcessor;
  private uploadProvider: UploadSourceProvider;
  private youtubeProvider: YouTubeProvider;

  constructor(
    storage: StorageProvider = defaultStorage,
    videoProcessor: VideoProcessor = defaultVideoProcessor
  ) {
    this.storage = storage;
    this.videoProcessor = videoProcessor;
    this.uploadProvider = new UploadSourceProvider(this.storage);
    this.youtubeProvider = new YouTubeProvider(this.storage);
  }

  /**
   * Realiza a ingestão de um arquivo de vídeo enviado por upload
   */
  async ingestUpload(
    projectId: string,
    file: UploadedFileInfo,
    options: IngestionOptions = { autoExtractAudio: true }
  ) {
    const project = await prisma.project.findUnique({ where: { id: projectId } });
    if (!project) {
      throw new Error('Projeto não encontrado para vincular o vídeo.');
    }

    // 1. Validar o arquivo antes de criar o registro
    const validation = this.uploadProvider.validate(file);
    if (!validation.valid) {
      throw new Error(validation.error || 'INVALID_VIDEO: Arquivo de vídeo inválido.');
    }

    // 2. Criar registro inicial no banco com status CREATED
    const video = await prisma.video.create({
      data: {
        projectId,
        originalName: file.originalName || 'video_upload.mp4',
        sourceType: 'UPLOAD',
        storagePath: 'pending',
        status: 'CREATED',
        progress: 10,
        currentStep: 'Iniciando upload e validação...',
      },
    });

    try {
      // 3. Salvar o arquivo no storage com nome e caminho seguros
      await prisma.video.update({
        where: { id: video.id },
        data: {
          status: 'DOWNLOADING',
          progress: 25,
          currentStep: 'Gravando arquivo de vídeo no storage...',
        },
      });

      const stored = await this.uploadProvider.store(file, video.id);

      await prisma.video.update({
        where: { id: video.id },
        data: {
          storagePath: stored.storagePath,
          fileSize: BigInt(stored.fileSize),
          status: 'DOWNLOADED',
          progress: 50,
          currentStep: 'Lendo metadados do vídeo com FFprobe...',
        },
      });

      // 4. Obter metadados reais com ffprobe
      const metadata = await this.videoProcessor.getMetadata(stored.absolutePath);

      await prisma.video.update({
        where: { id: video.id },
        data: {
          duration: metadata.duration,
          width: metadata.width,
          height: metadata.height,
          progress: 70,
          currentStep: 'Metadados lidos com sucesso.',
        },
      });

      // 5. Extração real de áudio com ffmpeg
      if (options.autoExtractAudio) {
        await this.extractAudio(video.id);
      } else {
        await prisma.video.update({
          where: { id: video.id },
          data: {
            status: 'DOWNLOADED',
            progress: 100,
            currentStep: 'Vídeo armazenado com sucesso.',
          },
        });
      }

      const updated = await prisma.video.findUnique({ where: { id: video.id } });
      return serializePrisma(updated);
    } catch (err: any) {
      console.error(`Falha na ingestão do vídeo ${video.id}:`, err);
      const updated = await prisma.video.update({
        where: { id: video.id },
        data: {
          status: 'FAILED',
          errorMessage: err.message || 'Falha no processamento do vídeo.',
          currentStep: 'Erro no processamento do vídeo.',
        },
      });
      throw new Error(err.message || 'Falha na ingestão do vídeo.');
    }
  }

  /**
   * Realiza a ingestão de um vídeo a partir de URL do YouTube
   */
  async ingestYouTube(
    projectId: string,
    url: string,
    options: IngestionOptions = { autoExtractAudio: true }
  ) {
    if (!YouTubeProvider.isValidYouTubeUrl(url)) {
      throw new Error('INVALID_YOUTUBE_URL: Por favor, forneça uma URL válida do YouTube.');
    }

    const project = await prisma.project.findUnique({ where: { id: projectId } });
    if (!project) {
      throw new Error('Projeto não encontrado para vincular o vídeo.');
    }

    // 1. Criar registro inicial no banco
    const video = await prisma.video.create({
      data: {
        projectId,
        originalName: 'Vídeo do YouTube',
        sourceType: 'YOUTUBE',
        sourceUrl: url.trim(),
        storagePath: 'pending',
        status: 'DOWNLOADING',
        progress: 15,
        currentStep: 'Conectando ao YouTube para download...',
      },
    });

    try {
      // 2. Baixar vídeo real com yt-dlp
      const downloadResult = await this.youtubeProvider.download(url, video.id);

      await prisma.video.update({
        where: { id: video.id },
        data: {
          originalName: downloadResult.info.title || 'Vídeo do YouTube',
          storagePath: downloadResult.storagePath,
          fileSize: BigInt(downloadResult.fileSize),
          status: 'DOWNLOADED',
          progress: 50,
          currentStep: 'Download concluído. Lendo metadados...',
        },
      });

      // Atualizar nome do projeto se estiver com nome padrão
      if (project.name === 'Novo Projeto' || project.name.startsWith('Projeto ')) {
        await prisma.project.update({
          where: { id: projectId },
          data: { name: downloadResult.info.title },
        });
      }

      // 3. Obter metadados reais com ffprobe
      const metadata = await this.videoProcessor.getMetadata(downloadResult.absolutePath);

      await prisma.video.update({
        where: { id: video.id },
        data: {
          duration: metadata.duration || downloadResult.info.duration || 0,
          width: metadata.width || downloadResult.info.width || 1280,
          height: metadata.height || downloadResult.info.height || 720,
          progress: 70,
          currentStep: 'Metadados confirmados com FFprobe.',
        },
      });

      // 4. Extrair áudio real com ffmpeg
      if (options.autoExtractAudio) {
        await this.extractAudio(video.id);
      }

      const finalVideo = await prisma.video.findUnique({ where: { id: video.id } });
      return serializePrisma(finalVideo);
    } catch (err: any) {
      console.error(`Falha no download/processamento do YouTube para o vídeo ${video.id}:`, err);
      await prisma.video.update({
        where: { id: video.id },
        data: {
          status: 'FAILED',
          errorMessage: err.message || 'Falha ao baixar vídeo do YouTube.',
          currentStep: 'Erro no download do YouTube.',
        },
      });
      throw err;
    }
  }

  /**
   * Extração real de áudio de um vídeo existente para formato WAV compatível
   */
  async extractAudio(videoId: string) {
    const video = await prisma.video.findUnique({ where: { id: videoId } });
    if (!video) {
      throw new Error('Vídeo não encontrado para extração de áudio.');
    }

    if (!video.storagePath || video.storagePath === 'pending') {
      throw new Error('Arquivo de vídeo ainda não foi gravado no storage.');
    }

    const videoAbsolutePath = this.storage.getAbsolutePath(video.storagePath);
    if (!fs.existsSync(videoAbsolutePath)) {
      throw new Error(`Arquivo de vídeo não encontrado no caminho: ${videoAbsolutePath}`);
    }

    await prisma.video.update({
      where: { id: videoId },
      data: {
        status: 'EXTRACTING_AUDIO',
        progress: 80,
        currentStep: 'Extraindo trilha de áudio com FFmpeg...',
      },
    });

    try {
      const audioKey = `audio/${videoId}.wav`;
      const audioAbsolutePath = this.storage.getAbsolutePath(audioKey);

      // Usar o processador de vídeo para extração em WAV/PCM mono 16kHz
      await this.videoProcessor.extractAudio(videoAbsolutePath, audioAbsolutePath);

      const updated = await prisma.video.update({
        where: { id: videoId },
        data: {
          audioPath: audioKey,
          status: 'AUDIO_READY',
          progress: 100,
          currentStep: 'Vídeo e áudio preparados para análise.',
        },
      });

      return serializePrisma(updated);
    } catch (err: any) {
      console.error(`Erro ao extrair áudio do vídeo ${videoId}:`, err);
      await prisma.video.update({
        where: { id: videoId },
        data: {
          status: 'FAILED',
          errorMessage: `AUDIO_EXTRACTION_FAILED: ${err.message}`,
          currentStep: 'Falha na extração de áudio.',
        },
      });
      throw new Error(`AUDIO_EXTRACTION_FAILED: ${err.message}`);
    }
  }

  /**
   * Retorna o status detalhado do vídeo
   */
  async getVideoStatus(videoId: string) {
    const video = await prisma.video.findUnique({
      where: { id: videoId },
      include: {
        project: {
          select: {
            id: true,
            name: true,
            status: true,
          },
        },
        transcript: {
          include: {
            segments: {
              select: {
                id: true,
                startTime: true,
                endTime: true,
                text: true,
                _count: {
                  select: { words: true },
                },
              },
              orderBy: { startTime: 'asc' },
            },
          },
        },
      },
    });

    if (!video) {
      throw new Error('Vídeo não encontrado.');
    }

    const segmentsCount = video.transcript?.segments.length || 0;
    const wordsCount = video.transcript?.segments.reduce((acc, seg) => acc + (seg._count?.words || 0), 0) || 0;

    return serializePrisma({
      id: video.id,
      projectId: video.projectId,
      originalName: video.originalName,
      status: video.status,
      progress: video.progress,
      currentStep: video.currentStep,
      duration: video.duration,
      width: video.width,
      height: video.height,
      fileSize: video.fileSize,
      audioPath: video.audioPath,
      storagePath: video.storagePath,
      error: video.errorMessage || null,
      project: video.project,
      transcript: video.transcript
        ? {
            id: video.transcript.id,
            language: video.transcript.language,
            text: video.transcript.text,
            segmentsCount,
            wordsCount,
            segments: video.transcript.segments,
          }
        : null,
    });
  }
}

export const defaultVideoIngestionService = new VideoIngestionService();
