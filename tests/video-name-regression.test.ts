import { describe, expect, it } from 'vitest';
import { normalizeDisplayName } from '../lib/services/video-ingestion-service';

describe('VIDEO NAME REGRESSION', () => {
  it('1/5 trims surrounding whitespace', () => {
    expect(normalizeDisplayName('  Meu vídeo novo  ')).toBe('Meu vídeo novo');
  });

  it('2/5 keeps an explicit name instead of source filename', () => {
    const userName = normalizeDisplayName('Podcast EP 42');
    const sourceName = 'DJ-STREAM-2026-09-02.mp4';
    expect(userName || sourceName).toBe('Podcast EP 42');
  });

  it('3/5 returns undefined for empty names so source title can be used as fallback', () => {
    expect(normalizeDisplayName('   ')).toBeUndefined();
    expect(normalizeDisplayName(undefined)).toBeUndefined();
  });

  it('4/5 truncates very long names deterministically', () => {
    const name = 'A'.repeat(240);
    const normalized = normalizeDisplayName(name);
    expect(normalized).toHaveLength(200);
    expect(normalized).toBe('A'.repeat(200));
  });

  it('5/5 preserves different user names across repeated source submissions', () => {
    const first = normalizeDisplayName('Corte podcast 01');
    const retry = normalizeDisplayName('Corte podcast 02');
    expect(first).toBe('Corte podcast 01');
    expect(retry).toBe('Corte podcast 02');
    expect(first).not.toBe(retry);
  });
});
