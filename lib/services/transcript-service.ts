import { prisma } from '../db/prisma';
import { StorageProvider } from '../storage/storage-provider';
import { defaultStorage } from '../storage/providers/local-storage-provider';
import {
  TranscriptionProvider,
  TranscriptionResult,
  TranscriptionResultSchema,
  TranscriptSegmentDTO,
} from '../transcription/transcription-provider';
import { defaultTranscriptionProvider } from '../transcription/providers/gemini-transcription-provider';
import { serializePrisma } from '../utils/serializer';
import fs from 'fs';

export interface TranscribeOptions {
  language?: string;
  forceRetranscribe?: boolean;
}

export class TranscriptService {
  private storage: StorageProvider;
  private provider: TranscriptionProvider;

  constructor(
    storage: StorageProvider = defaultStorage,
    provider: TranscriptionProvider = defaultTranscriptionProvider
  ) {
    this.storage = storage;
    this.provider = provider;
  }

  /**
   * Formata a transcrição em blocos com timestamps [MM:SS.ms - MM:SS.ms] para prompt do Gemini
   */
  static formatTranscriptForAI(segments: { startTime: number; endTime: number; text: string }[]): string {
    const formatTime = (seconds: number) => {
      const mins = Math.floor(seconds / 60);
      const secs = (seconds % 60).toFixed(2);
      const paddedMins = String(mins).padStart(2, '0');
      const paddedSecs = Number(secs) < 10 ? `0${secs}` : secs;
      return `${paddedMins}:${paddedSecs}`;
    };

    return segments
      .map(seg => `[${formatTime(seg.startTime)} - ${formatTime(seg.endTime)}]\n${seg.text.trim()}`)
      .join('\n\n');
  }

  /**
   * Transcreve o áudio de um vídeo e persiste os segmentos e palavras no banco de dados de forma transacional
   */
  async transcribeVideo(videoId: string, options: TranscribeOptions = {}) {
    const video = await prisma.video.findUnique({
      where: { id: videoId },
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
    });

    if (!video) {
      throw new Error('VIDEO_NOT_FOUND: Vídeo não encontrado.');
    }

    // Se já tiver transcrição válida e não for solicitado re-transcrição, retorna a existente
    if (
      video.transcript &&
      video.transcript.segments.length > 0 &&
      !options.forceRetranscribe &&
      video.status === 'TRANSCRIBED'
    ) {
      return serializePrisma(video.transcript);
    }

    // Verificar existência do arquivo de áudio
    if (!video.audioPath) {
      throw new Error('AUDIO_NOT_FOUND: O arquivo de áudio deste vídeo ainda não foi extraído.');
    }

    const audioAbsolutePath = this.storage.getAbsolutePath(video.audioPath);
    if (!fs.existsSync(audioAbsolutePath)) {
      throw new Error(`AUDIO_NOT_FOUND: Arquivo de áudio não encontrado no caminho: ${audioAbsolutePath}`);
    }

    // Verificar disponibilidade do provider
    const isAvailable = await this.provider.isAvailable();
    if (!isAvailable) {
      throw new Error('TRANSCRIPTION_UNAVAILABLE: O serviço de transcrição não está disponível ou configurado.');
    }

    // Atualizar status para TRANSCRIBING
    await prisma.video.update({
      where: { id: videoId },
      data: {
        status: 'TRANSCRIBING',
        progress: 85,
        currentStep: 'Transcrevendo áudio e identificando timestamps com IA...',
        errorMessage: null,
      },
    });

    try {
      // Executar transcrição real
      const transcriptionResult = await this.provider.transcribe(audioAbsolutePath, {
        language: options.language || 'pt',
      });

      // Validar dados da transcrição
      const validation = TranscriptionResultSchema.safeParse(transcriptionResult);
      if (!validation.success) {
        throw new Error(`INVALID_TRANSCRIPTION: Dados de transcrição inválidos: ${validation.error.message}`);
      }

      const { language, text, segments } = validation.data;

      // Executar gravação atômica no banco de dados via Prisma transaction
      const savedTranscript = await prisma.$transaction(async (tx) => {
        // Excluir transcrição anterior se houver (para retentativas limpas)
        await tx.transcript.deleteMany({
          where: { videoId },
        });

        // Criar Transcript principal
        const transcript = await tx.transcript.create({
          data: {
            videoId,
            language,
            text,
          },
        });

        // Criar Segmentos e Palavras em lote
        for (const seg of segments) {
          const createdSegment = await tx.transcriptSegment.create({
            data: {
              transcriptId: transcript.id,
              startTime: seg.startTime,
              endTime: seg.endTime,
              text: seg.text,
            },
          });

          if (seg.words && seg.words.length > 0) {
            await tx.transcriptWord.createMany({
              data: seg.words.map(w => ({
                segmentId: createdSegment.id,
                word: w.word,
                startTime: w.startTime,
                endTime: w.endTime,
              })),
            });
          }
        }

        // Atualizar status do vídeo para TRANSCRIBED
        await tx.video.update({
          where: { id: videoId },
          data: {
            status: 'TRANSCRIBED',
            progress: 100,
            currentStep: 'Transcrição e timestamps concluídos com sucesso.',
            errorMessage: null,
          },
        });

        return tx.transcript.findUnique({
          where: { id: transcript.id },
          include: {
            segments: {
              include: { words: true },
              orderBy: { startTime: 'asc' },
            },
          },
        });
      });

      return serializePrisma(savedTranscript);
    } catch (err: any) {
      console.error(`Erro ao transcrever vídeo ${videoId}:`, err);
      const errorMessage = err.message || 'Falha na transcrição do áudio.';

      await prisma.video.update({
        where: { id: videoId },
        data: {
          status: 'FAILED',
          errorMessage,
          currentStep: 'Falha durante a transcrição.',
        },
      });

      throw err;
    }
  }

  /**
   * Recupera a transcrição completa de um vídeo
   */
  async getTranscript(videoId: string) {
    const transcript = await prisma.transcript.findUnique({
      where: { videoId },
      include: {
        segments: {
          include: { words: true },
          orderBy: { startTime: 'asc' },
        },
      },
    });

    if (!transcript) {
      return null;
    }

    return serializePrisma(transcript);
  }
}

export const defaultTranscriptService = new TranscriptService();
