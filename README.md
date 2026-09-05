# OPUS-COPY

> **AI-powered desktop/local video clipper for Windows**

Transforme vídeos longos em Shorts, Reels e TikToks com uma pipeline local de ingestão, transcrição, análise semântica, seleção de momentos, reenquadramento, legendas e renderização.

## O que foi implementado

### 🎥 Entrada e ingestão

- Upload de vídeo local.
- URL do YouTube via `yt-dlp`.
- Armazenamento local com IDs independentes por vídeo.
- Extração de áudio com FFmpeg.
- Leitura de duração, resolução e metadados com FFprobe.
- Limite de upload configurado no servidor.
- Tratamento de erros de download, áudio e mídia.

### 🧠 Seleção inteligente

A análise usa Gemini para encontrar momentos que possam funcionar como conteúdo curto independente. O pipeline valida os timestamps contra a transcrição real antes de salvar o clip.

O ranking considera:

| Critério | Função |
| --- | --- |
| Hook | força dos primeiros segundos |
| Clarity | compreensão imediata |
| Emotion | emoção, humor e identificação |
| Curiosity | vontade de continuar assistindo |
| Standalone context | independência do contexto externo |
| Value | informação, utilidade ou entretenimento |

O score final é calculado deterministicamente pelo OPUS-COPY, evitando que a IA simplesmente invente uma nota.

### 🎯 Perfis de conteúdo

O motor de score possui presets:

- `viral`
- `education`
- `storytelling`
- `humor`
- `marketing`
- `podcast`

Configure com:

```env
OPUS_CONTENT_PROFILE="viral"
```

O perfil altera os pesos sem quebrar o formato de dados já existente.

### 🛡️ Quality Gate

Antes de um candidato entrar no ranking final, o OPUS-COPY verifica se hook, clareza e contexto independente atingem um nível mínimo. Isso reduz clips que parecem bons numericamente, mas começam sem contexto ou terminam sem payoff.

### ✂️ Anti-alucinação e qualidade temporal

- Timestamps são ancorados em segmentos reais da transcrição.
- Clips com texto insuficiente são descartados.
- Início e fim são ajustados para respeitar palavras/segmentos reais.
- Clips semelhantes são deduplicados.
- O resultado final é limitado pela quantidade solicitada.

### 📝 Transcrição

- `faster-whisper` para o caminho local rápido.
- Timestamps por palavra.
- Cache por vídeo/transcrição no banco.
- Seleção explícita de idioma.
- WhisperX permanece disponível como opção especializada.

### 📱 Vídeo vertical

- Reframe 9:16.
- Processamento com FFmpeg.
- H.264 + AAC.
- Geração de legendas automáticas.
- Preview do trecho na interface atual.

### 🎨 Editor e projeto

A interface web/desktop atual já possui fluxo de projeto, seleção de clips, transcript viewer, edição de clip, preview e renderização. O projeto mantém serviços separados para ingestão, transcrição, análise, storage, jobs e render.

### ⚡ Renderização e fila

- Render assíncrono.
- Status `QUEUED`, `PROCESSING`, `COMPLETED` e `FAILED`.
- Progresso persistido no banco.
- Polling da interface para acompanhar trabalhos.
- Renderização individual e suporte à evolução para lote.

## Correção importante: vídeo antigo sendo reutilizado

O projeto tinha um ponto de fragilidade: a relação `project -> videos` não tinha uma ordem determinística. Ao adicionar uma nova URL ao mesmo projeto, `videos[0]` podia representar um vídeo antigo.

Agora `ProjectService` sempre retorna os vídeos por `createdAt desc`. Assim:

```text
Projeto
 ├── vídeo novo   ← primaryVideo
 ├── vídeo antigo
 └── vídeo antigo
```

Isso impede que a interface escolha aleatoriamente um vídeo anterior quando uma nova fonte é adicionada.

## Arquitetura

```text
                 OPUS-COPY
                     │
             ┌───────┴────────┐
             │     Entrada    │
             └───────┬────────┘
                     │
          Upload / YouTube URL
                     │
                     ▼
              Video Ingestion
                     │
          ┌──────────┴──────────┐
          │                     │
       FFprobe               FFmpeg
          │                     │
      metadata                audio
          │                     │
          └──────────┬──────────┘
                     ▼
              Transcription
                     │
          faster-whisper / WhisperX
                     │
                     ▼
              Gemini Analysis
                     │
        Hook / Context / Emotion
        Curiosity / Clarity / Value
                     │
                     ▼
               Quality Gate
                     │
                     ▼
             Score + Deduplication
                     │
                     ▼
               Clip Selection
                     │
          ┌──────────┴──────────┐
          │                     │
   Face Detection          Subtitles
          │                     │
   Face Tracking                │
          │                     │
   Smooth Reframe 9:16          │
          └──────────┬──────────┘
                     ▼
                  FFmpeg
                     │
                     ▼
                 MP4 9:16
```

## Stack

| Tecnologia | Função |
| --- | --- |
| React + Vite | Interface web |
| TypeScript | Serviços e API |
| Express | Backend local |
| Prisma + SQLite | Persistência |
| Python + PySide6 | Pipeline desktop Windows |
| yt-dlp | Download YouTube |
| FFmpeg / FFprobe | Mídia e renderização |
| faster-whisper | Transcrição rápida |
| WhisperX | Transcrição/alinhamento especializado |
| Gemini | Seleção semântica |
| Zod | Validação |
| Vitest | Testes |
| PyInstaller | Empacotamento `.exe` |

## Estrutura principal

```text
OPUS-COPY/
├── src/                         # interface React
├── lib/
│   ├── ai/                      # prompts e providers de IA
│   ├── clips/                   # análise, score, deduplicação
│   ├── jobs/                    # fila local
│   ├── services/                # ingestão, projeto, transcript, render
│   ├── storage/                 # storage local
│   ├── transcription/           # providers de transcrição
│   ├── validation/              # schemas
│   └── video/                   # providers, reframe e subtitles
├── desktop/                     # aplicativo Python/Windows
├── scripts/                     # setup WhisperX
├── prisma/                      # schema e banco local
├── server.ts                    # API Express
└── tests/                       # testes automatizados
```

## Instalação

### Node / aplicação web

```powershell
npm install
npm run prisma:generate
npm run prisma:push
npm run dev
```

### Configuração

Copie `.env.example` para `.env` e configure:

```env
DATABASE_URL="file:./dev.db"
GEMINI_API_KEY="SUA_CHAVE"
APP_URL="http://localhost:3000"
OPUS_CONTENT_PROFILE="viral"
WHISPER_DEVICE="auto"
WHISPER_MODEL="small"
WHISPER_COMPUTE_TYPE="int8"
```

Nunca publique sua API key no GitHub.

### Desktop Windows

Para usuários finais, baixe o instalador automático:

**[Baixar OPUS-COPY-Setup.exe](https://github.com/contatomulvin-bot/OPUS-COPY/releases/download/installer-latest/OPUS-COPY-Setup.exe)**

O instalador verifica e baixa Git, Python 3.11, Node.js e FFmpeg, prepara a IA, solicita a chave Gemini, cria atalhos e adiciona o desinstalador do Windows. Os clips ficam salvos separadamente em `%LOCALAPPDATA%\OPUS-COPY\data`, portanto não são apagados ao desinstalar o programa.

Também existe a instalação direta pelo PowerShell:

```powershell
irm https://raw.githubusercontent.com/contatomulvin-bot/OPUS-COPY/main/install.ps1 | iex
```

Para desenvolvimento manual:

```powershell
.\desktop\setup.ps1
.\desktop\run.ps1
```

O setup prepara o ambiente Python, faster-whisper, yt-dlp, EJS e o PO Token Provider usado pelo fluxo de download do YouTube.

## AMD / RX 7600

O OPUS-COPY não assume que uma GPU AMD deve ser tratada como CUDA.

Para Windows, a disponibilidade de aceleração depende do backend instalado. O caminho de transcrição deve ter fallback para CPU quando GPU não estiver disponível.

A RX 7600 é uma GPU RDNA3 `gfx1102`. Existem builds comunitárias de `whisper.cpp` com aceleração AMD/ROCm para RX 7600, enquanto o suporte oficial de ROCm no Windows deve ser verificado contra a versão do HIP SDK instalada antes de habilitar um backend específico.

Para uma instalação que não tenha aceleração AMD funcional, o aplicativo continua podendo usar CPU.

## Testes

```powershell
npm run lint
npm run test
npm run build
```

Os testes automatizados cobrem especialmente o ranking determinístico e o quality gate. Testes de download, FFmpeg, GPU e APIs externas dependem do ambiente real.

## Roadmap

### Concluído / núcleo

- [x] Upload local
- [x] YouTube
- [x] Ingestão por vídeo independente
- [x] Extração de áudio
- [x] FFprobe
- [x] Transcrição local
- [x] Timestamps por palavra
- [x] Seleção semântica com IA
- [x] Ranking determinístico
- [x] Quality gate
- [x] Deduplicação
- [x] Ajuste de timestamps
- [x] 9:16
- [x] Legendas
- [x] Preview
- [x] Render assíncrono
- [x] Correção da seleção do vídeo mais recente

### Próxima camada

- [x] Reenquadramento dinâmico com detecção, tracking e trajetória suavizada do rosto
- [ ] HotPeak temporal multimodal
- [ ] Análise de frames para pessoas, gameplay e telas
- [ ] Edição em massa de legendas/reframe/Brand Kit
- [ ] Templates de legendas
- [ ] Brand Kit persistente
- [ ] Renderização em lote com progresso global
- [ ] Dashboard de jobs
- [ ] Presets TikTok / Reels / Shorts na UI
- [ ] Empacotamento `.exe` final totalmente automatizado
- [ ] Publicação/agendamento em redes sociais
- [ ] Monitoramento de lives

## Filosofia

O objetivo não é apenas cortar vídeo. É transformar:

```text
1 vídeo longo
      ↓
transcrição
      ↓
análise semântica
      ↓
melhores momentos
      ↓
clips independentes
      ↓
9:16 + legenda
      ↓
conteúdo pronto para publicação
```

Nenhum recurso é considerado realmente pronto apenas porque o código compila. Download, transcrição, IA, FFmpeg e GPU precisam ser validados no ambiente em que o usuário executará o aplicativo.

## Licença

Este projeto ainda não possui uma licença pública definida.

---

**OPUS-COPY — Turn long videos into clips worth watching.**
