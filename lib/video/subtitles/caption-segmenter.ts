import { Caption, CaptionWord } from '../types';

export interface RawSegmentInput {
  id?: string;
  startTime: number;
  endTime: number;
  text: string;
  words?: Array<{
    id?: string;
    word: string;
    startTime: number;
    endTime: number;
  }>;
}

export interface CaptionSegmenterOptions {
  minWordsPerCaption?: number; // default: 2
  maxWordsPerCaption?: number; // default: 6
  maxCharsPerCaption?: number; // default: 32 (ideal for vertical mobile reading)
  maxPauseDurationSeconds?: number; // default: 0.45s (break caption on pause)
  relativeToClipStart?: boolean; // if true, subtract clipStartTime
  clipStartTime?: number;
  clipEndTime?: number;
}

export class CaptionSegmenter {
  /**
   * Segments transcription data into punchy, mobile-friendly caption blocks
   */
  segment(
    segments: RawSegmentInput[],
    options: CaptionSegmenterOptions = {}
  ): Caption[] {
    const minWords = options.minWordsPerCaption ?? 2;
    const maxWords = options.maxWordsPerCaption ?? 5;
    const maxChars = options.maxCharsPerCaption ?? 32;
    const maxPause = options.maxPauseDurationSeconds ?? 0.45;
    const clipStart = options.clipStartTime ?? 0;
    const clipEnd = options.clipEndTime ?? Infinity;
    const relative = options.relativeToClipStart ?? true;

    // Collect all words across segments that intersect with the clip range
    const allWords: CaptionWord[] = [];

    for (const seg of segments) {
      if (seg.endTime < clipStart || seg.startTime > clipEnd) {
        continue;
      }

      if (seg.words && seg.words.length > 0) {
        for (const w of seg.words) {
          const wStart = Math.max(clipStart, w.startTime);
          const wEnd = Math.min(clipEnd, w.endTime);
          if (wEnd > wStart && w.startTime >= clipStart - 0.2 && w.endTime <= clipEnd + 0.2) {
            allWords.push({
              word: w.word.trim(),
              startTime: wStart,
              endTime: wEnd,
            });
          }
        }
      } else {
        // Synthesize approximate word timings from segment text
        const words = seg.text.trim().split(/\s+/).filter(Boolean);
        if (words.length > 0) {
          const segDuration = Math.max(0.1, seg.endTime - seg.startTime);
          const wordDuration = segDuration / words.length;

          for (let i = 0; i < words.length; i++) {
            const wStart = seg.startTime + i * wordDuration;
            const wEnd = wStart + wordDuration;
            if (wEnd >= clipStart && wStart <= clipEnd) {
              allWords.push({
                word: words[i],
                startTime: Math.max(clipStart, wStart),
                endTime: Math.min(clipEnd, wEnd),
              });
            }
          }
        }
      }
    }

    if (allWords.length === 0) {
      return [];
    }

    // Sort chronologically
    allWords.sort((a, b) => a.startTime - b.startTime);

    // Group words into captions
    const captions: Caption[] = [];
    let currentWords: CaptionWord[] = [];

    const flushCurrent = () => {
      if (currentWords.length === 0) return;

      const text = currentWords.map((w) => w.word).join(' ').trim();
      if (text) {
        const rawStart = currentWords[0].startTime;
        const rawEnd = currentWords[currentWords.length - 1].endTime;

        const effectiveStart = relative ? Math.max(0, rawStart - clipStart) : rawStart;
        const effectiveEnd = relative ? Math.max(effectiveStart + 0.1, rawEnd - clipStart) : rawEnd;

        captions.push({
          startTime: effectiveStart,
          endTime: effectiveEnd,
          text,
          words: currentWords.map((w) => ({
            word: w.word,
            startTime: relative ? Math.max(0, w.startTime - clipStart) : w.startTime,
            endTime: relative ? Math.max(0.1, w.endTime - clipStart) : w.endTime,
          })),
        });
      }
      currentWords = [];
    };

    for (let i = 0; i < allWords.length; i++) {
      const current = allWords[i];
      const prev = currentWords[currentWords.length - 1];

      // Check for natural break conditions
      let shouldBreak = false;

      if (prev) {
        const pause = current.startTime - prev.endTime;
        const currentTextLength = currentWords.map((w) => w.word).join(' ').length + 1 + current.word.length;
        const prevEndsSentence = /[.!?]$/.test(prev.word);
        const prevEndsClause = /[,;:]$/.test(prev.word);

        if (pause > maxPause) {
          // Significant acoustic pause
          shouldBreak = true;
        } else if (prevEndsSentence && currentWords.length >= minWords) {
          // Sentence ended
          shouldBreak = true;
        } else if (currentWords.length >= maxWords) {
          // Reached word limit
          shouldBreak = true;
        } else if (currentTextLength > maxChars && currentWords.length >= minWords) {
          // Line too wide for phone
          shouldBreak = true;
        } else if (prevEndsClause && currentWords.length >= minWords + 1) {
          // Clause ended and we have enough words
          shouldBreak = true;
        }
      }

      if (shouldBreak) {
        flushCurrent();
      }

      currentWords.push(current);
    }

    flushCurrent();

    // Secondary pass: avoid orphan 1-word captions at the end if they can merge with previous
    if (captions.length > 1) {
      const last = captions[captions.length - 1];
      const prev = captions[captions.length - 2];
      const lastWordCount = last.text.split(/\s+/).length;
      const prevWordCount = prev.text.split(/\s+/).length;

      if (lastWordCount === 1 && prevWordCount < maxWords && last.startTime - prev.endTime < 0.3) {
        prev.text = `${prev.text} ${last.text}`;
        prev.endTime = last.endTime;
        if (prev.words && last.words) {
          prev.words.push(...last.words);
        }
        captions.pop();
      }
    }

    return captions;
  }
}

export const defaultCaptionSegmenter = new CaptionSegmenter();
