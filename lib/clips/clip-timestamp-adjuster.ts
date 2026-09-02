export interface SegmentReference {
  id?: string;
  startTime: number;
  endTime: number;
  text: string;
  words?: Array<{
    word: string;
    startTime: number;
    endTime: number;
  }>;
}

export interface AdjustTimestampOptions {
  maxVideoDuration?: number;
  minDurationSeconds?: number;
  maxDurationSeconds?: number;
  snapToleranceSeconds?: number;
}

export class ClipTimestampAdjuster {
  /**
   * Ajusta os timestamps aproximados do modelo com base nos segmentos reais e palavras da transcrição
   */
  adjustCandidate(
    candidate: { startTime: number; endTime: number; title: string; hook: string },
    segments: SegmentReference[],
    options: AdjustTimestampOptions = {}
  ): { startTime: number; endTime: number; matchedText: string } | null {
    if (!segments || segments.length === 0) {
      return null;
    }

    const snapTolerance = options.snapToleranceSeconds ?? 3.5;
    const minDur = options.minDurationSeconds ?? 10;
    const maxDur = options.maxDurationSeconds ?? 180;
    const maxVideoDur = options.maxVideoDuration ?? segments[segments.length - 1].endTime + 2.0;

    let targetStart = Math.max(0, candidate.startTime);
    let targetEnd = Math.min(maxVideoDur, candidate.endTime);

    if (targetEnd <= targetStart) {
      targetEnd = targetStart + minDur;
    }

    // 1. Encontrar o melhor segmento de início
    // Procuramos o segmento mais próximo de targetStart dentro de snapTolerance
    let bestStartSegIndex = 0;
    let minStartDiff = Infinity;

    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i];
      // Distância do início do segmento ao targetStart
      const diff = Math.abs(seg.startTime - targetStart);
      if (diff < minStartDiff) {
        minStartDiff = diff;
        bestStartSegIndex = i;
      }
      // Se targetStart cair no meio de um segmento, preferimos o início desse segmento
      if (targetStart >= seg.startTime && targetStart <= seg.endTime) {
        bestStartSegIndex = i;
        break;
      }
    }

    // Se a distância for razoável, alinhamos com o início do segmento
    let adjustedStart = segments[bestStartSegIndex].startTime;

    // Se o segmento possuir palavras detalhadas, podemos refinar o início exato
    const startSeg = segments[bestStartSegIndex];
    if (startSeg.words && startSeg.words.length > 0) {
      for (const w of startSeg.words) {
        if (w.startTime >= targetStart - 1.0) {
          adjustedStart = w.startTime;
          break;
        }
      }
    }

    // 2. Encontrar o melhor segmento de término
    let bestEndSegIndex = segments.length - 1;
    let minEndDiff = Infinity;

    for (let i = bestStartSegIndex; i < segments.length; i++) {
      const seg = segments[i];
      const diff = Math.abs(seg.endTime - targetEnd);
      if (diff < minEndDiff) {
        minEndDiff = diff;
        bestEndSegIndex = i;
      }
      if (targetEnd >= seg.startTime && targetEnd <= seg.endTime) {
        bestEndSegIndex = i;
        break;
      }
    }

    let adjustedEnd = segments[bestEndSegIndex].endTime;

    // Se o segmento de fim tiver palavras detalhadas
    const endSeg = segments[bestEndSegIndex];
    if (endSeg.words && endSeg.words.length > 0) {
      for (let wIdx = endSeg.words.length - 1; wIdx >= 0; wIdx--) {
        const w = endSeg.words[wIdx];
        if (w.endTime <= targetEnd + 1.0) {
          adjustedEnd = w.endTime;
          break;
        }
      }
    }

    // Garantir limites
    adjustedStart = Math.max(0, Math.round(adjustedStart * 100) / 100);
    adjustedEnd = Math.min(maxVideoDur, Math.round(adjustedEnd * 100) / 100);

    // Validação de duração mínima e máxima
    const duration = adjustedEnd - adjustedStart;
    if (duration < minDur) {
      // Tentar expandir o final para o próximo segmento se disponível
      if (bestEndSegIndex + 1 < segments.length) {
        adjustedEnd = segments[bestEndSegIndex + 1].endTime;
      } else {
        adjustedEnd = Math.min(maxVideoDur, adjustedStart + minDur);
      }
    }

    // Coletar texto real contido entre adjustedStart e adjustedEnd
    const matchedSegments = segments.filter(
      seg => seg.endTime > adjustedStart && seg.startTime < adjustedEnd
    );
    const matchedText = matchedSegments.map(s => s.text.trim()).join(' ');

    if (adjustedEnd <= adjustedStart) {
      return null;
    }

    return {
      startTime: Math.round(adjustedStart * 100) / 100,
      endTime: Math.round(adjustedEnd * 100) / 100,
      matchedText,
    };
  }
}

export const defaultClipTimestampAdjuster = new ClipTimestampAdjuster();
