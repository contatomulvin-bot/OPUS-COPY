import { ClipSubScores } from './types';

export interface ScorerWeights {
  hook: number;
  clarity: number;
  emotion: number;
  curiosity: number;
  standaloneContext: number;
  value: number;
}

export const DEFAULT_SCORER_WEIGHTS: ScorerWeights = {
  hook: 0.25,
  clarity: 0.15,
  emotion: 0.15,
  curiosity: 0.15,
  standaloneContext: 0.15,
  value: 0.15,
};

export class ClipScorer {
  private weights: ScorerWeights;

  constructor(weights: ScorerWeights = DEFAULT_SCORER_WEIGHTS) {
    this.weights = weights;
  }

  /**
   * Calcula o AI Score (0 a 100) ponderado a partir dos sub-scores
   */
  calculateScore(subScores: ClipSubScores): number {
    const rawScore =
      (subScores.hook ?? 0) * this.weights.hook +
      (subScores.clarity ?? 0) * this.weights.clarity +
      (subScores.emotion ?? 0) * this.weights.emotion +
      (subScores.curiosity ?? 0) * this.weights.curiosity +
      (subScores.standaloneContext ?? 0) * this.weights.standaloneContext +
      (subScores.value ?? 0) * this.weights.value;

    const clamped = Math.max(0, Math.min(100, rawScore));
    return Math.round(clamped);
  }

  /**
   * Valida e sanitiza sub-scores
   */
  sanitizeSubScores(scores: Partial<ClipSubScores>): ClipSubScores {
    const clamp = (val?: number) => {
      if (val === undefined || isNaN(val) || !isFinite(val)) return 50;
      return Math.max(0, Math.min(100, Math.round(val)));
    };

    return {
      hook: clamp(scores.hook),
      clarity: clamp(scores.clarity),
      emotion: clamp(scores.emotion),
      curiosity: clamp(scores.curiosity),
      standaloneContext: clamp(scores.standaloneContext),
      value: clamp(scores.value),
    };
  }
}

export const defaultClipScorer = new ClipScorer();
