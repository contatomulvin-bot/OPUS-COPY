import { SegmentReference } from './clip-timestamp-adjuster';

export interface TranscriptChunk {
  chunkIndex: number;
  totalChunks: number;
  startTime: number;
  endTime: number;
  segments: SegmentReference[];
  formattedTranscript: string;
}

export interface ChunkerOptions {
  maxChunkDurationSeconds?: number; // ex: 600 segundos (10 minutos)
  overlapDurationSeconds?: number;  // ex: 60 segundos de overlap
  maxSegmentsPerChunk?: number;     // ex: 150 segmentos
}

export class TranscriptChunker {
  /**
   * Formata os segmentos em texto com timestamps [MM:SS.ms - MM:SS.ms] para envio à IA
   */
  static formatSegments(segments: SegmentReference[]): string {
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
   * Divide uma lista de segmentos em chunks temporais com sobreposição de contexto
   */
  chunkTranscript(segments: SegmentReference[], options: ChunkerOptions = {}): TranscriptChunk[] {
    if (!segments || segments.length === 0) {
      return [];
    }

    const maxChunkDuration = options.maxChunkDurationSeconds ?? 600; // 10 mins
    const overlapDuration = options.overlapDurationSeconds ?? 60;   // 1 min
    const maxSegmentsPerChunk = options.maxSegmentsPerChunk ?? 150;

    const totalDuration = segments[segments.length - 1].endTime - segments[0].startTime;

    // Se o vídeo for curto ou tiver poucos segmentos, processa tudo em um único chunk
    if (totalDuration <= maxChunkDuration && segments.length <= maxSegmentsPerChunk) {
      return [
        {
          chunkIndex: 0,
          totalChunks: 1,
          startTime: segments[0].startTime,
          endTime: segments[segments.length - 1].endTime,
          segments,
          formattedTranscript: TranscriptChunker.formatSegments(segments),
        },
      ];
    }

    const chunks: TranscriptChunk[] = [];
    let currentStartSegIndex = 0;

    while (currentStartSegIndex < segments.length) {
      const chunkStart = segments[currentStartSegIndex].startTime;
      const targetChunkEnd = chunkStart + maxChunkDuration;

      let currentEndSegIndex = currentStartSegIndex;
      while (
        currentEndSegIndex < segments.length &&
        segments[currentEndSegIndex].endTime <= targetChunkEnd &&
        currentEndSegIndex - currentStartSegIndex < maxSegmentsPerChunk
      ) {
        currentEndSegIndex++;
      }

      // Garantir pelo menos 1 segmento no chunk
      if (currentEndSegIndex === currentStartSegIndex && currentEndSegIndex < segments.length) {
        currentEndSegIndex = currentStartSegIndex + 1;
      }

      const chunkSegments = segments.slice(currentStartSegIndex, currentEndSegIndex);
      const chunkEnd = chunkSegments[chunkSegments.length - 1].endTime;

      chunks.push({
        chunkIndex: chunks.length,
        totalChunks: 0, // Será atualizado após finalizar o loop
        startTime: chunkStart,
        endTime: chunkEnd,
        segments: chunkSegments,
        formattedTranscript: TranscriptChunker.formatSegments(chunkSegments),
      });

      if (currentEndSegIndex >= segments.length) {
        break;
      }

      // Calcular o próximo ponto de início considerando a sobreposição
      const nextTargetStart = chunkEnd - overlapDuration;
      let nextStartIndex = currentStartSegIndex + 1;

      for (let i = currentStartSegIndex + 1; i < currentEndSegIndex; i++) {
        if (segments[i].startTime >= nextTargetStart) {
          nextStartIndex = i;
          break;
        }
      }

      // Avanço garantido
      if (nextStartIndex <= currentStartSegIndex) {
        nextStartIndex = currentStartSegIndex + Math.max(1, Math.floor(chunkSegments.length / 2));
      }

      currentStartSegIndex = nextStartIndex;
    }

    // Atualizar totalChunks
    chunks.forEach(c => (c.totalChunks = chunks.length));

    return chunks;
  }
}

export const defaultTranscriptChunker = new TranscriptChunker();
