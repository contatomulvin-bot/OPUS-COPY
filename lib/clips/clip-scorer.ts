import { ClipSubScores } from './types';

export type ContentProfile = 'viral' | 'education' | 'storytelling' | 'humor' | 'marketing' | 'podcast';

export interface ScorerWeights {
  hook: number;
  clarity: number;
  emotion: number;
  curiosity: number;
  standaloneContext: number;
  value: number;
}

const BASE_WEIGHTS: ScorerWeights = {
  hook: 0.25,
  clarity: 0.15,
  emotion: 0.15,
  curiosity: 0.15,
  standaloneContext: 0.15,
  value: 0.15,
};

/** Platform/content presets. They deliberately keep the same six AI dimensions
 * so old Gemini responses remain compatible with the existing database schema. */
export const PROFILE_WEIGHTS: Record<ContentProfile, ScorerWeights> = {
  viral: { hook: 0.30, clarity: 0.10, emotion: 0.18, curiosity: 0.18, standaloneContext: 0.12, value: 0.12 },
  education: { hook: 0.18, clarity: 0.22, emotion: 0.08, curiosity: 0.14, standaloneContext: 0.18, value: 0.20 },
  storytelling: { hook: 0.22, clarity: 0.14, emotion: 0.22, curiosity: 0.16, standaloneContext: 0.18, value: 0.08 },
  humor: { hook: 0.24, clarity: 0.12, emotion: 0.28, curiosity: 0.18, standaloneContext: 0.10, value: 0.08 },
  marketing: { hook: 0.24, clarity: 0.16, emotion: 0.12, curiosity: 0.16, standaloneContext: 0.16, value: 0.16 },
  podcast: { hook: 0.26, clarity: 0.16, emotion: 0.16, curiosity: 0.16, standaloneContext: 0.16, value: 0.10 },
};

export const DEFAULT_SCORER_WEIGHTS: ScorerWeights = BASE_WEIGHTS;

export class ClipScorer {
  private weights: ScorerWeights;

  constructor(weights: ScorerWeights = DEFAULT_SCORER_WEIGHTS) {
    this.weights = weights;
  }

  /** Calcula o AI Score (0 a 100) ponderado. */
  calculateScore(subScores: ClipSubScores): number {
    const rawScore =
      (subScores.hook ?? 0) * this.weights.hook +
      (subScores.clarity ?? 0) * this.weights.clarity +
      (subScores.emotion ?? 0) * this.weights.emotion +
      (subScores.curiosity ?? 0) * this.weights.curiosity +
      (subScores.standaloneContext ?? 0) * this.weights.standaloneContext +
      (subScores.value ?? 0) * this.weights.value;

    return Math.round(Math.max(0, Math.min(100, rawScore)));
  }

  /** Retorna um scorer ajustado sem alterar o contrato antigo. */
  forProfile(profile?: string): ClipScorer {
    const normalized = (profile || 'viral').toLowerCase() as ContentProfile;
    return new ClipScorer(PROFILE_WEIGHTS[normalized] || BASE_WEIGHTS);
  }

  /**
   * Quality gate: impede que um clip com gancho/contexto muito fraco apareça
   * artificialmente alto apenas por ter uma boa nota em outro eixo.
   */
  passesQualityGate(scores: ClipSubScores): boolean {
    const critical = [scores.hook, scores.clarity, scores.standaloneContext];
    return critical.every(value => Number.isFinite(value) && value >= 35);
  }

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
