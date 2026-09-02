import { describe, it, expect } from 'vitest';
import assert from 'assert';
import {
  ClipCandidateSchema,
  ClipAnalysisResponseSchema,
  CLIP_CATEGORIES,
} from '../lib/clips/types';
import { ClipScorer, DEFAULT_SCORER_WEIGHTS } from '../lib/clips/clip-scorer';
import { ClipTimestampAdjuster, SegmentReference } from '../lib/clips/clip-timestamp-adjuster';
import { ClipDeduplicator } from '../lib/clips/clip-deduplicator';
import { TranscriptChunker } from '../lib/clips/transcript-chunker';

describe('FASE 4: INTELIGÊNCIA DO AI CLIPPER', () => {
  // 1. TESTES DO ZOD SCHEMA (ClipAnalysisSchema)
  it('ClipCandidateSchema: Deve validar candidato válido', () => {
    const validCandidate = {
      startTime: 12.5,
      endTime: 45.2,
      title: 'O maior erro que cometi',
      hook: 'Se você fizer isso, vai perder tudo em 24h',
      description: 'Explica o erro fatal ao gerenciar investimentos sem reserva de emergência',
      category: 'STORY',
      score: 92,
      scores: {
        hook: 95,
        clarity: 90,
        emotion: 88,
        curiosity: 94,
        standaloneContext: 92,
        value: 90,
      },
    };

    const parsed = ClipCandidateSchema.parse(validCandidate);
    assert.strictEqual(parsed.title, validCandidate.title);
    assert.strictEqual(parsed.score, 92);
  });

  it('ClipCandidateSchema: Deve rejeitar startTime negativo', () => {
    assert.throws(() => {
      ClipCandidateSchema.parse({
        startTime: -5,
        endTime: 30,
        title: 'Título',
        hook: 'Hook',
        description: 'Desc',
        category: 'OPINION',
        score: 80,
        scores: { hook: 80, clarity: 80, emotion: 80, curiosity: 80, standaloneContext: 80, value: 80 },
      });
    });
  });

  it('ClipCandidateSchema: Deve rejeitar endTime menor ou igual a startTime', () => {
    assert.throws(() => {
      ClipCandidateSchema.parse({
        startTime: 50,
        endTime: 40,
        title: 'Título',
        hook: 'Hook',
        description: 'Desc',
        category: 'EDUCATION',
        score: 80,
        scores: { hook: 80, clarity: 80, emotion: 80, curiosity: 80, standaloneContext: 80, value: 80 },
      });
    });
  });

  it('ClipCandidateSchema: Deve rejeitar categorias fora do enum', () => {
    assert.throws(() => {
      ClipCandidateSchema.parse({
        startTime: 10,
        endTime: 40,
        title: 'Título',
        hook: 'Hook',
        description: 'Desc',
        category: 'INVALID_CATEGORY_TEST',
        score: 80,
        scores: { hook: 80, clarity: 80, emotion: 80, curiosity: 80, standaloneContext: 80, value: 80 },
      });
    });
  });

  // 2. TESTES DO CLIP SCORER
  it('ClipScorer: Deve calcular pontuação ponderada honesta de 0 a 100', () => {
    const scorer = new ClipScorer(DEFAULT_SCORER_WEIGHTS);
    const subScores = {
      hook: 100, // 25% = 25
      clarity: 80, // 15% = 12
      emotion: 90, // 15% = 13.5
      curiosity: 90, // 15% = 13.5
      standaloneContext: 80, // 15% = 12
      value: 70, // 15% = 10.5
    };
    // Total esperado: 25 + 12 + 13.5 + 13.5 + 12 + 10.5 = 86.5 => 87
    const score = scorer.calculateScore(subScores);
    assert.strictEqual(score, 87);
  });

  it('ClipScorer: Deve sanitizar sub-scores inválidos ou ausentes', () => {
    const scorer = new ClipScorer();
    const sanitized = scorer.sanitizeSubScores({
      hook: 120, // deve ser clamped a 100
      clarity: -10, // deve ser clamped a 0
      emotion: undefined, // fallback 50
    });
    assert.strictEqual(sanitized.hook, 100);
    assert.strictEqual(sanitized.clarity, 0);
    assert.strictEqual(sanitized.emotion, 50);
  });

  // 3. TESTES DO CLIP TIMESTAMP ADJUSTER
  it('ClipTimestampAdjuster: Deve ajustar e ancorar tempos aos segmentos reais da transcrição', () => {
    const adjuster = new ClipTimestampAdjuster();

    const mockSegments: SegmentReference[] = [
      { id: '1', startTime: 0.0, endTime: 5.2, text: 'Olá pessoal sejam bem-vindos ao podcast.' },
      { id: '2', startTime: 5.2, endTime: 12.8, text: 'Hoje vamos falar sobre como escalar produtos com IA.' },
      { id: '3', startTime: 12.8, endTime: 24.5, text: 'O maior erro que as pessoas cometem é não testar com usuários reais.' },
      { id: '4', startTime: 24.5, endTime: 38.0, text: 'Quando lançamos nosso primeiro app, achávamos que sabíamos tudo mas não sabíamos nada.' },
      { id: '5', startTime: 38.0, endTime: 52.0, text: 'E a lição foi: valide a ideia antes de programar uma única linha de código.' },
    ];

    // IA propôs aproximadamente 13.2s até 51.5s
    const adjusted = adjuster.adjustCandidate(
      { startTime: 13.2, endTime: 51.5, title: 'Validação de Produtos', hook: 'O maior erro' },
      mockSegments,
      { maxVideoDuration: 60.0 }
    );

    assert.ok(adjusted !== null);
    // Deve ajustar para o início do segmento 3 (12.8) e término do segmento 5 (52.0)
    assert.strictEqual(adjusted.startTime, 12.8);
    assert.strictEqual(adjusted.endTime, 52.0);
    assert.ok(adjusted.matchedText.includes('O maior erro'));
    assert.ok(adjusted.matchedText.includes('valide a ideia antes de programar'));
  });

  // 4. TESTES DO CLIP DEDUPLICATOR
  it('ClipDeduplicator: Deve eliminar candidatos com alta sobreposição temporal mantendo o maior score', () => {
    const deduplicator = new ClipDeduplicator();

    const candidates = [
      {
        startTime: 10.0,
        endTime: 40.0,
        title: 'Versão Fraca do Corte',
        hook: 'Frase de gancho fraca',
        description: 'Desc A',
        category: 'OPINION' as const,
        score: 75,
        scores: { hook: 70, clarity: 75, emotion: 70, curiosity: 75, standaloneContext: 80, value: 75 },
      },
      {
        startTime: 12.0,
        endTime: 42.0,
        title: 'Versão Forte do Corte',
        hook: 'Como perdi 1 milhão por não validar',
        description: 'Desc B',
        category: 'STORY' as const,
        score: 95,
        scores: { hook: 98, clarity: 95, emotion: 92, curiosity: 96, standaloneContext: 94, value: 95 },
      },
      {
        startTime: 80.0,
        endTime: 120.0,
        title: 'Outro Momento Distinto',
        hook: 'A segunda estratégia secreta',
        description: 'Desc C',
        category: 'ADVICE' as const,
        score: 88,
        scores: { hook: 88, clarity: 88, emotion: 85, curiosity: 90, standaloneContext: 88, value: 89 },
      },
    ];

    const result = deduplicator.deduplicate(candidates, { maxTemporalOverlapRatio: 0.60 });

    // Candidato 1 e 2 têm sobreposição de ~90%. O de score 95 deve ser mantido e o de 75 eliminado.
    assert.strictEqual(result.length, 2);
    assert.strictEqual(result[0].score, 95);
    assert.strictEqual(result[0].title, 'Versão Forte do Corte');
    assert.strictEqual(result[1].score, 88);
    assert.strictEqual(result[1].title, 'Outro Momento Distinto');
  });

  // 5. TESTES DO TRANSCRIPT CHUNKER
  it('TranscriptChunker: Deve manter vídeos curtos em 1 único chunk e dividir vídeos longos com overlap', () => {
    const chunker = new TranscriptChunker();

    // Caso 1: Vídeo de 2 minutos
    const shortSegments: SegmentReference[] = [
      { id: '1', startTime: 0, endTime: 30, text: 'Primeira parte' },
      { id: '2', startTime: 30, endTime: 60, text: 'Segunda parte' },
      { id: '3', startTime: 60, endTime: 120, text: 'Terceira parte' },
    ];

    const singleChunk = chunker.chunkTranscript(shortSegments, { maxChunkDurationSeconds: 300 });
    assert.strictEqual(singleChunk.length, 1);
    assert.strictEqual(singleChunk[0].startTime, 0);
    assert.strictEqual(singleChunk[0].endTime, 120);

    // Caso 2: Vídeo longo dividido em chunks com overlap
    const longSegments: SegmentReference[] = [];
    for (let i = 0; i < 40; i++) {
      longSegments.push({
        id: `seg-${i}`,
        startTime: i * 30,
        endTime: (i + 1) * 30,
        text: `Texto do bloco ${i} com conteúdo relevante`,
      });
    } // Total: 1200s (20 minutos)

    const chunks = chunker.chunkTranscript(longSegments, {
      maxChunkDurationSeconds: 400,
      overlapDurationSeconds: 60,
    });

    assert.ok(chunks.length >= 3);
    assert.strictEqual(chunks[0].chunkIndex, 0);
    // O segundo chunk deve começar antes do final do primeiro (sobreposição de contexto)
    assert.ok(chunks[1].startTime < chunks[0].endTime);
  });
});
