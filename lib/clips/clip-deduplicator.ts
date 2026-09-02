import { ClipCandidate } from './types';

export interface DeduplicationOptions {
  maxTemporalOverlapRatio?: number; // ex: 0.60 (60%)
  maxCandidates?: number;
}

export class ClipDeduplicator {
  /**
   * Calcula a taxa de sobreposição temporal (Intersection over Union) entre dois intervalos
   */
  static calculateTemporalOverlap(a: { startTime: number; endTime: number }, b: { startTime: number; endTime: number }): number {
    const intersectionStart = Math.max(a.startTime, b.startTime);
    const intersectionEnd = Math.min(a.endTime, b.endTime);
    const intersection = Math.max(0, intersectionEnd - intersectionStart);

    if (intersection === 0) return 0;

    const durationA = a.endTime - a.startTime;
    const durationB = b.endTime - b.startTime;
    const minDuration = Math.min(durationA, durationB);

    // Overlap relativo ao menor clip (se um estiver 70%+ contido no outro, é duplicata)
    return intersection / (minDuration || 1);
  }

  /**
   * Calcula similaridade de Jaccard entre duas strings de texto
   */
  static calculateTextSimilarity(textA: string, textB: string): number {
    const tokenize = (t: string) =>
      new Set(
        t
          .toLowerCase()
          .replace(/[^\w\s]/g, '')
          .split(/\s+/)
          .filter(w => w.length > 2)
      );

    const setA = tokenize(textA);
    const setB = tokenize(textB);

    if (setA.size === 0 || setB.size === 0) return 0;

    let intersectionCount = 0;
    for (const item of setA) {
      if (setB.has(item)) intersectionCount++;
    }

    const unionSize = new Set([...setA, ...setB]).size;
    return unionSize === 0 ? 0 : intersectionCount / unionSize;
  }

  /**
   * Remove candidatos duplicados ou com alta sobreposição redundante, mantendo os melhores classificados
   */
  deduplicate(candidates: ClipCandidate[], options: DeduplicationOptions = {}): ClipCandidate[] {
    if (!candidates || candidates.length === 0) return [];

    const maxOverlap = options.maxTemporalOverlapRatio ?? 0.65;
    const maxCandidates = options.maxCandidates ?? 10;

    // 1. Ordenar primeiro por score DESC
    const sorted = [...candidates].sort((a, b) => (b.score ?? 0) - (a.score ?? 0));

    const selected: ClipCandidate[] = [];

    for (const candidate of sorted) {
      let isDuplicate = false;

      for (const existing of selected) {
        const temporalOverlap = ClipDeduplicator.calculateTemporalOverlap(candidate, existing);
        const textSimilarity = ClipDeduplicator.calculateTextSimilarity(
          `${candidate.title} ${candidate.hook} ${candidate.matchedText || ''}`,
          `${existing.title} ${existing.hook} ${existing.matchedText || ''}`
        );

        // Se houver grande overlap temporal (> 65%) ou moderado (> 45%) com alta similaridade textual (> 60%)
        if (temporalOverlap >= maxOverlap || (temporalOverlap >= 0.45 && textSimilarity >= 0.60)) {
          isDuplicate = true;
          break;
        }
      }

      if (!isDuplicate) {
        selected.push(candidate);
      }

      if (selected.length >= maxCandidates) {
        break;
      }
    }

    // Re-ordenar por score final decrescente
    return selected.sort((a, b) => b.score - a.score);
  }
}

export const defaultClipDeduplicator = new ClipDeduplicator();
