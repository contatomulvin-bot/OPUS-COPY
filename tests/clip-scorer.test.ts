import { describe, expect, it } from 'vitest';
import { ClipScorer, PROFILE_WEIGHTS } from '../lib/clips/clip-scorer';

describe('ClipScorer', () => {
  const strong = {
    hook: 95,
    clarity: 90,
    emotion: 88,
    curiosity: 94,
    standaloneContext: 92,
    value: 86,
  };

  it('calculates a bounded deterministic score', () => {
    const score = new ClipScorer(PROFILE_WEIGHTS.viral).calculateScore(strong);
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(100);
    expect(score).toBe(92);
  });

  it('rejects clips with weak hook/context even if other scores are high', () => {
    const scorer = new ClipScorer(PROFILE_WEIGHTS.viral);
    expect(scorer.passesQualityGate({ ...strong, hook: 20 })).toBe(false);
    expect(scorer.passesQualityGate({ ...strong, standaloneContext: 20 })).toBe(false);
    expect(scorer.passesQualityGate(strong)).toBe(true);
  });

  it('supports content profiles without changing the public score contract', () => {
    const scorer = new ClipScorer(PROFILE_WEIGHTS.viral);
    const educationScore = scorer.forProfile('education').calculateScore(strong);
    const humorScore = scorer.forProfile('humor').calculateScore(strong);
    expect(educationScore).toBeGreaterThan(0);
    expect(humorScore).toBeGreaterThan(0);
    expect(Number.isInteger(educationScore)).toBe(true);
    expect(Number.isInteger(humorScore)).toBe(true);
  });
});
