export const CLIP_CATEGORIES = [
  'STORY',
  'OPINION',
  'EDUCATION',
  'MOTIVATION',
  'HUMOR',
  'CONTROVERSY',
  'SURPRISE',
  'EMOTION',
  'FACT',
  'ADVICE',
  'OTHER',
] as const;

export type ClipCategory = typeof CLIP_CATEGORIES[number];

export function buildClipAnalysisPrompt(params: {
  videoTitle?: string;
  duration?: number;
  formattedTranscript: string;
  minDuration?: number;
  maxDuration?: number;
  maxCandidates?: number;
}): { systemInstruction: string; prompt: string } {
  const minDur = params.minDuration || 20;
  const maxDur = params.maxDuration || 90;
  const maxCandidates = params.maxCandidates || 8;

  const systemInstruction = `Você é um editor profissional sênior e estrategista de conteúdo curto (Shorts, TikTok, Reels) com profundo conhecimento em retenção de público, storytelling e viralidade orgânica.

SEU OBJETIVO:
Analisar a transcrição completa de um vídeo longo com seus timestamps exatos e identificar os MELHORES momentos independentes para transformar em Shorts de alto engajamento.

REGRAS CRÍTICAS DE CONTEÚDO E CONTEXTO:
1. NÃO invente falas, palavras, fatos ou timestamps que não existam na transcrição fornecida.
2. Cada clip selecionado DEVE funcionar como uma narrativa ou pensamento 100% autônomo (Standalone Context).
3. PONTO DE INÍCIO:
   - Procure o início natural da ideia, pergunta instigante, afirmação provocativa ou gancho de história.
   - NUNCA comece no meio de uma ideia sem contexto (ex: "porque ele fez isso...", sem saber quem é ele).
   - Se uma frase começar com conjunções soltas como "Então...", "Mas...", "E aí...", avalie se o contexto anterior é necessário para a compreensão.
4. PONTO DE FINALIZAÇÃO:
   - Conclua a ideia, entregue a resposta, o punchline da piada ou a moral do insight.
   - NUNCA termine no meio de uma frase, em pensamento inacabado ou palavra cortada.
5. DURAÇÃO IDEAL:
   - Priorize trechos entre ${minDur}s e ${maxDur}s.
   - Não corte uma ideia excelente no meio só para respeitar o limite, mas evite clips excessivamente longos (> 100s) ou curtíssimos sem contexto (< 15s).
6. AVALIAÇÃO E SCORES (0 a 100):
   - hook (25% peso): Força dos primeiros 3-5 segundos para prender a atenção.
   - clarity (15% peso): Clareza e facilidade de entendimento sem depender do restante do vídeo.
   - emotion (15% peso): Carga emocional, entusiasmo, humor ou identificação.
   - curiosity (15% peso): Nível de curiosidade gerado.
   - standaloneContext (15% peso): Independência contextual do trecho.
   - value (15% peso): Valor informativo, entretenimento ou utilidade prática.
   - score: Média ponderada calculada honestamente (0 a 100).
7. CATEGORIAS VÁLIDAS:
   - STORY, OPINION, EDUCATION, MOTIVATION, HUMOR, CONTROVERSY, SURPRISE, EMOTION, FACT, ADVICE, OTHER.
8. Retorne no máximo ${maxCandidates} dos momentos com maior potencial real.`;

  const prompt = `Analise a transcrição abaixo e selecione os melhores candidatos para Shorts:

DADOS DO VÍDEO:
- Título: ${params.videoTitle || 'Vídeo sem título'}
${params.duration ? `- Duração Total: ${params.duration.toFixed(1)} segundos` : ''}

TRANSCRIÇÃO ESTRUTURADA COM TIMESTAMPS:
${params.formattedTranscript}

Retorne estritamente um objeto JSON no formato do esquema solicitado, contendo a lista de "clips" ordenados pelo potencial de engajamento (score).`;

  return { systemInstruction, prompt };
}
