import { GoogleGenAI, Type } from '@google/genai';
import {
  ClipCandidate,
  ClipAnalysisResponseSchema,
  ClipCategory,
  CLIP_CATEGORIES,
} from './types';
import { buildClipAnalysisPrompt } from '../ai/prompts/clip-analysis-prompt';
import { ClipScorer, defaultClipScorer } from './clip-scorer';
import { ClipTimestampAdjuster, defaultClipTimestampAdjuster, SegmentReference } from './clip-timestamp-adjuster';
import { ClipDeduplicator, defaultClipDeduplicator } from './clip-deduplicator';
import { TranscriptChunker, defaultTranscriptChunker } from './transcript-chunker';

export interface AnalyzeTranscriptOptions {
  videoTitle?: string;
  videoDuration?: number;
  minClipDuration?: number;
  maxClipDuration?: number;
  maxCandidates?: number;
}

export class ClipAnalyzer {
  private client: GoogleGenAI | null = null;
  private scorer: ClipScorer;
  private timestampAdjuster: ClipTimestampAdjuster;
  private deduplicator: ClipDeduplicator;
  private chunker: TranscriptChunker;

  constructor(
    scorer: ClipScorer = defaultClipScorer,
    timestampAdjuster: ClipTimestampAdjuster = defaultClipTimestampAdjuster,
    deduplicator: ClipDeduplicator = defaultClipDeduplicator,
    chunker: TranscriptChunker = defaultTranscriptChunker
  ) {
    this.scorer = scorer;
    this.timestampAdjuster = timestampAdjuster;
    this.deduplicator = deduplicator;
    this.chunker = chunker;
  }

  private getClient(): GoogleGenAI {
    if (!this.client) {
      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey) {
        throw new Error('ANALYSIS_UNAVAILABLE: GEMINI_API_KEY não configurada no servidor.');
      }
      this.client = new GoogleGenAI({
        apiKey,
        httpOptions: { headers: { 'User-Agent': 'opus-copy' } },
      });
    }
    return this.client;
  }

  async analyzeTranscript(
    segments: SegmentReference[],
    options: AnalyzeTranscriptOptions = {}
  ): Promise<ClipCandidate[]> {
    if (!segments || segments.length === 0) {
      throw new Error('TRANSCRIPT_NOT_FOUND: Transcrição vazia ou sem segmentos para análise.');
    }

    const ai = this.getClient();
    const maxCandidates = options.maxCandidates ?? 10;
    const minClipDuration = options.minClipDuration ?? 20;
    const maxClipDuration = options.maxClipDuration ?? 90;
    const videoDuration = options.videoDuration ?? segments[segments.length - 1].endTime;

    // Configurable without breaking the existing API/UI. Set OPUS_CONTENT_PROFILE
    // to viral, education, storytelling, humor, marketing or podcast.
    const profile = process.env.OPUS_CONTENT_PROFILE || 'viral';
    const scorer = this.scorer.forProfile(profile);
    const chunks = this.chunker.chunkTranscript(segments);
    const rawCandidates: ClipCandidate[] = [];

    for (const chunk of chunks) {
      const { systemInstruction, prompt } = buildClipAnalysisPrompt({
        videoTitle: options.videoTitle,
        duration: chunk.endTime - chunk.startTime,
        formattedTranscript: chunk.formattedTranscript,
        minDuration: minClipDuration,
        maxDuration: maxClipDuration,
        maxCandidates: Math.ceil(maxCandidates / chunks.length) + 3,
      });

      try {
        const response = await ai.models.generateContent({
          model: 'gemini-3.7-flash',
          contents: [{ text: prompt }],
          config: {
            systemInstruction,
            responseMimeType: 'application/json',
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                clips: {
                  type: Type.ARRAY,
                  description: 'Lista de momentos destacados com alto potencial para Shorts',
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      startTime: { type: Type.NUMBER, description: 'Timestamp inicial em segundos' },
                      endTime: { type: Type.NUMBER, description: 'Timestamp final em segundos' },
                      title: { type: Type.STRING, description: 'Título curto e chamativo' },
                      hook: { type: Type.STRING, description: 'Gancho real do conteúdo' },
                      description: { type: Type.STRING, description: 'Por que o trecho funciona isoladamente' },
                      category: { type: Type.STRING, enum: CLIP_CATEGORIES as unknown as string[] },
                      score: { type: Type.INTEGER, description: 'Score estimado de 0 a 100' },
                      scores: {
                        type: Type.OBJECT,
                        properties: {
                          hook: { type: Type.INTEGER, description: 'Gancho 0-100' },
                          clarity: { type: Type.INTEGER, description: 'Clareza 0-100' },
                          emotion: { type: Type.INTEGER, description: 'Emoção/humor 0-100' },
                          curiosity: { type: Type.INTEGER, description: 'Curiosidade 0-100' },
                          standaloneContext: { type: Type.INTEGER, description: 'Contexto independente 0-100' },
                          value: { type: Type.INTEGER, description: 'Valor/entretenimento 0-100' },
                        },
                        required: ['hook', 'clarity', 'emotion', 'curiosity', 'standaloneContext', 'value'],
                      },
                    },
                    required: ['startTime', 'endTime', 'title', 'hook', 'description', 'category', 'score', 'scores'],
                  },
                },
              },
              required: ['clips'],
            },
          },
        });

        const rawText = response.text?.trim() || '{}';
        let parsedJson: any;
        try {
          parsedJson = JSON.parse(rawText);
        } catch {
          throw new Error('INVALID_AI_RESPONSE: Resposta do modelo não pôde ser interpretada como JSON.');
        }

        const validated = ClipAnalysisResponseSchema.safeParse(parsedJson);
        const candidateList = (validated.success ? validated.data.clips : (parsedJson.clips || [])) as ClipCandidate[];

        for (const rawCandidate of candidateList) {
          const sanitizedScores = scorer.sanitizeSubScores(rawCandidate.scores || {});

          // Quality gate before ranking: a clip cannot become "viral" while
          // lacking a usable hook, clarity or standalone context.
          if (!scorer.passesQualityGate(sanitizedScores)) continue;

          const calculatedScore = scorer.calculateScore(sanitizedScores);
          const adjusted = this.timestampAdjuster.adjustCandidate(
            {
              startTime: rawCandidate.startTime,
              endTime: rawCandidate.endTime,
              title: rawCandidate.title,
              hook: rawCandidate.hook,
            },
            segments,
            { maxVideoDuration: videoDuration, minDurationSeconds: 15, maxDurationSeconds: 120 }
          );

          if (!adjusted || !adjusted.matchedText || adjusted.matchedText.trim().length < 10) continue;

          const safeCategory: ClipCategory = CLIP_CATEGORIES.includes(rawCandidate.category)
            ? rawCandidate.category
            : 'OTHER';

          rawCandidates.push({
            startTime: adjusted.startTime,
            endTime: adjusted.endTime,
            title: String(rawCandidate.title || 'Destaque do Vídeo').trim(),
            hook: String(rawCandidate.hook || rawCandidate.title || '').trim(),
            description: String(rawCandidate.description || '').trim(),
            category: safeCategory,
            score: calculatedScore,
            scores: sanitizedScores,
            matchedText: adjusted.matchedText,
          });
        }
      } catch (err: any) {
        console.error(`Erro ao analisar transcrição no chunk ${chunk.chunkIndex}:`, err);
        if (err.message?.startsWith('ANALYSIS_') || err.message?.startsWith('INVALID_') || err.message?.startsWith('TRANSCRIPT_')) throw err;
        throw new Error(`ANALYSIS_FAILED: ${err.message || 'Falha na análise semântica do vídeo com IA.'}`);
      }
    }

    if (rawCandidates.length === 0) {
      throw new Error('NO_CLIPS_FOUND: Nenhum momento com potencial de corte autônomo foi identificado na transcrição.');
    }

    return this.deduplicator.deduplicate(rawCandidates, {
      maxCandidates,
      maxTemporalOverlapRatio: 0.65,
    });
  }
}

export const defaultClipAnalyzer = new ClipAnalyzer();
