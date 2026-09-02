import { TranscriptSegmentDTO } from '../transcription/transcription-provider';
import { AIClipItem } from '../validation/schemas';

export interface AnalyzeTranscriptOptions {
  videoDuration: number;
  videoTitle?: string;
  minDuration?: number; // default ~20s
  maxDuration?: number; // default ~90s
  targetCount?: number; // default 3-6 clips
}

export interface AIClipAnalyzer {
  analyzeTranscript(
    segments: TranscriptSegmentDTO[],
    options: AnalyzeTranscriptOptions
  ): Promise<AIClipItem[]>;
}
