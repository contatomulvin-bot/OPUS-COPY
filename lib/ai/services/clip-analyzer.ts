import { TranscriptSegmentDTO } from '../../transcription/transcription-provider';
import { AIClipItem } from '../../validation/schemas';
import { AIClipAnalyzer, AnalyzeTranscriptOptions } from '../ai-clip-analyzer';
import { GeminiClipAnalyzerProvider } from '../providers/gemini-provider';

export class ClipAnalyzerService {
  private provider: AIClipAnalyzer;

  constructor(provider?: AIClipAnalyzer) {
    this.provider = provider || new GeminiClipAnalyzerProvider();
  }

  /**
   * Calculates intersection over union (IoU) overlap ratio between two time intervals
   */
  private calculateOverlap(aStart: number, aEnd: number, bStart: number, bEnd: number): number {
    const overlapStart = Math.max(aStart, bStart);
    const overlapEnd = Math.min(aEnd, bEnd);
    const overlapDuration = Math.max(0, overlapEnd - overlapStart);

    const minDuration = Math.min(aEnd - aStart, bEnd - bStart);
    if (minDuration <= 0) return 0;

    return overlapDuration / minDuration;
  }

  /**
   * Deduplicates candidate clips by removing heavily overlapping clips (>40% overlap),
   * retaining the clip with the higher score.
   */
  deduplicateClips(clips: AIClipItem[]): AIClipItem[] {
    if (clips.length <= 1) return clips;

    // Sort by score descending first
    const sorted = [...clips].sort((a, b) => b.score - a.score);
    const selected: AIClipItem[] = [];

    for (const candidate of sorted) {
      let isDuplicate = false;
      for (const kept of selected) {
        const overlap = this.calculateOverlap(
          candidate.startTime,
          candidate.endTime,
          kept.startTime,
          kept.endTime
        );

        // If overlap is greater than 40%, it is considered duplicate/redundant
        if (overlap > 0.40) {
          isDuplicate = true;
          break;
        }
      }

      if (!isDuplicate) {
        selected.push(candidate);
      }
    }

    // Return deduplicated list sorted by score
    return selected.sort((a, b) => b.score - a.score);
  }

  /**
   * Analyzes transcript, validates boundaries, scores, and deduplicates clips
   */
  async findBestMoments(
    segments: TranscriptSegmentDTO[],
    options: AnalyzeTranscriptOptions
  ): Promise<AIClipItem[]> {
    if (!segments || segments.length === 0) {
      throw new Error('Transcrição vazia: nenhum segmento para analisar.');
    }

    const rawCandidates = await this.provider.analyzeTranscript(segments, options);

    // Sanitize and boundary check
    const videoDuration = Math.max(options.videoDuration || 0, segments[segments.length - 1]?.endTime || 0);

    const validatedCandidates: AIClipItem[] = rawCandidates
      .filter(c => c && typeof c.startTime === 'number' && typeof c.endTime === 'number')
      .map(c => {
        const startTime = Math.max(0, c.startTime);
        const endTime = Math.min(videoDuration > 0 ? videoDuration : c.endTime, Math.max(startTime + 3, c.endTime));
        const score = Math.min(100, Math.max(0, Math.round(c.score)));

        return {
          ...c,
          startTime: Number(startTime.toFixed(2)),
          endTime: Number(endTime.toFixed(2)),
          score,
        };
      })
      .filter(c => c.endTime > c.startTime);

    // Run deduplication
    const deduplicated = this.deduplicateClips(validatedCandidates);

    // If no candidate was found or deduplication left 0, create a reasonable fallback from segments
    if (deduplicated.length === 0 && segments.length > 0) {
      const firstSeg = segments[0];
      const lastSeg = segments[Math.min(segments.length - 1, 10)];
      deduplicated.push({
        startTime: firstSeg.startTime,
        endTime: Math.min(videoDuration || 60, Math.max(firstSeg.startTime + 15, lastSeg.endTime)),
        title: 'Destaque Principal',
        hook: 'Introdução e ponto alto do vídeo',
        description: 'Trecho inicial com visão geral do conteúdo.',
        score: 85,
      });
    }

    return deduplicated;
  }
}

export const defaultClipAnalyzerService = new ClipAnalyzerService();
