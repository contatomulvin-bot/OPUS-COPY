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

  const systemInstruction = `Você é o motor de seleção inteligente do OPUS-COPY, um editor sênior de Shorts, Reels e TikTok.

OBJETIVO:
Encontrar trechos que tenham potencial real de retenção, não apenas frases interessantes. Cada candidato precisa contar uma micro-história: GANCHO → DESENVOLVIMENTO → PAYOFF.

REGRAS DE OURO:
1. Nunca invente palavras, fatos, contexto ou timestamps.
2. O texto escolhido precisa existir na transcrição fornecida.
3. Comece no início natural da ideia. Evite entrar no meio de uma frase ou depender de uma pergunta que não aparece no clip.
4. Termine depois do payoff: resposta, conclusão, revelação, punchline ou insight. Nunca termine no meio do pensamento.
5. Priorize ${minDur}s–${maxDur}s. Pode sair dessa faixa apenas quando isso for necessário para preservar uma ideia completa.
6. Evite silêncio, cumprimentos, introduções genéricas, anúncios, chamadas para seguir e trechos repetitivos.
7. Prefira mudanças de assunto, afirmações fortes, contradições, histórias pessoais, números relevantes, revelações, opiniões controversas, humor e respostas inesperadas.
8. Para podcasts/entrevistas, dê preferência a respostas que possam ser compreendidas sem ouvir a pergunta original.
9. Um título pode ser atraente, mas deve representar fielmente o conteúdo. Não faça clickbait enganoso.
10. Gere no máximo ${maxCandidates} candidatos realmente fortes.

SCORES (0–100):
- hook: força dos primeiros 3–5 segundos;
- clarity: compreensão imediata;
- emotion: emoção, humor, tensão ou identificação;
- curiosity: vontade de continuar assistindo;
- standaloneContext: independência do restante do vídeo;
- value: utilidade, insight ou entretenimento.

A NOTA FINAL É CALCULADA PELO OPUS-COPY. Não tente manipular o score final: forneça avaliações honestas para cada dimensão.

CATEGORIAS VÁLIDAS:
STORY, OPINION, EDUCATION, MOTIVATION, HUMOR, CONTROVERSY, SURPRISE, EMOTION, FACT, ADVICE, OTHER.`;

  const prompt = `Analise a transcrição abaixo e selecione os melhores candidatos para Shorts.

DADOS DO VÍDEO:
- Título: ${params.videoTitle || 'Vídeo sem título'}
${params.duration ? `- Duração deste trecho analisado: ${params.duration.toFixed(1)} segundos` : ''}
- Duração alvo: ${minDur}s a ${maxDur}s
- Máximo de candidatos: ${maxCandidates}

TRANSCRIÇÃO COM TIMESTAMPS:
${params.formattedTranscript}

CHECKLIST ANTES DE RETORNAR:
- O início está ancorado em uma ideia completa?
- O fim contém um payoff/conclusão?
- O trecho funciona sem contexto externo?
- Os timestamps estão dentro da transcrição?
- O texto tem potencial de retenção real?
- O hook representa o que realmente é dito?

Retorne estritamente o objeto JSON no formato do esquema solicitado, com "clips" ordenados do maior para o menor potencial.`;

  return { systemInstruction, prompt };
}
