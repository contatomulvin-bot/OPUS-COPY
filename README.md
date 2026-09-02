<img width="1073" height="756" alt="image" src="https://github.com/user-attachments/assets/ade5d149-2ce6-476b-97e2-5fe9a5af2d74" />
# OPUS-COPY

> **AI-powered desktop video clipper for Windows**

Transforme vídeos longos em clips verticais prontos para publicação.

O **OPUS-COPY** é um aplicativo desktop desenvolvido para encontrar automaticamente os melhores momentos de vídeos longos usando IA, gerar cortes, adicionar legendas e preparar o conteúdo em formato vertical 9:16.

---

## ✨ Recursos

* 🎥 Download de vídeos do YouTube
* 🤖 Análise automática dos melhores momentos com IA
* 🧠 Transcrição com WhisperX
* ✂️ Geração automática de clips
* 📱 Conversão para formato vertical 9:16
* 📝 Legendas automáticas
* 🎬 Processamento com FFmpeg
* 🔎 Seleção baseada em potencial de retenção
* 🖥️ Interface desktop para Windows
* ⚡ Processamento em segundo plano sem travar a interface
* 🧹 Gerenciamento de arquivos temporários
* 📋 Diagnóstico detalhado de erros
* 🧩 Suporte a PO Token Provider para o ecossistema atual do YouTube

---

## 🧠 Como funciona

```text
YouTube URL
     │
     ▼
┌──────────────┐
│   yt-dlp     │
│   Download   │
└──────┬───────┘
       │
       ▼
┌──────────────┐
│   WhisperX   │
│ Transcrição  │
└──────┬───────┘
       │
       ▼
┌──────────────┐
│     IA       │
│ Clip Analysis│
└──────┬───────┘
       │
       ▼
┌──────────────┐
│    FFmpeg    │
│    Render     │
└──────┬───────┘
       │
       ▼
  MP4 9:16
  + Legendas
```

---

## 🛠️ Tecnologias

| Tecnologia | Função                      |
| ---------- | --------------------------- |
| Python     | Backend e pipeline          |
| PySide6    | Interface desktop           |
| yt-dlp     | Download de vídeos          |
| WhisperX   | Transcrição                 |
| Gemini     | Análise com IA              |
| FFmpeg     | Edição e renderização       |
| SQLite     | Persistência local          |
| PowerShell | Setup e execução no Windows |

---

## 💻 Requisitos

### Sistema

* Windows 10 ou Windows 11
* Python 3.11 x64
* Git
* Internet
* Espaço em disco suficiente para vídeos e processamento

### Dependências principais

* Python 3.11
* PySide6
* yt-dlp
* WhisperX
* FFmpeg
* ffprobe
* Google Gemini SDK
* PO Token Provider

---

# 🚀 Instalação

Clone o repositório:

```powershell
git clone https://github.com/contatomulvin-bot/OPUS-COPY.git
cd OPUS-COPY
```

Execute o setup:

```powershell
.\desktop\setup.ps1
```

O script cria o ambiente virtual e instala as dependências necessárias.

Depois inicie o aplicativo:

```powershell
.\desktop\run.ps1
```

---

# 🔑 Configuração da IA

Crie um arquivo `.env` na raiz do projeto:

```env
GEMINI_API_KEY=SEU_TOKEN_AQUI
```

Nunca publique sua API key no GitHub.

---

# 📁 Estrutura do projeto

```text
OPUS-COPY/
│
├── desktop/
│   ├── main.py
│   ├── requirements.txt
│   ├── setup.ps1
│   ├── run.ps1
│   │
│   └── opus_copy/
│       ├── analyzer.py
│       ├── downloader.py
│       ├── pipeline.py
│       ├── renderer.py
│       ├── tools.py
│       └── transcriber.py
│
├── .env
├── .gitignore
└── README.md
```

---

# 🎯 Seleção inteligente de clips

O OPUS-COPY não deve simplesmente cortar intervalos aleatórios do vídeo.

A análise considera características como:

* Hook
* Emoção
* Curiosidade
* Clareza
* Valor
* Entretenimento
* Contexto independente
* Potencial de retenção
* Força do início
* Força do final
* Duração ideal
* Sobreposição entre clips

Os clips também devem passar por deduplicação para evitar vários cortes praticamente iguais.

---

# 🎞️ Saída

Os clips são preparados para conteúdo vertical:

```text
Formato: MP4
Aspect ratio: 9:16
Vídeo: H.264
Áudio: AAC
Legendas: automáticas
```

A ideia é gerar vídeos compatíveis com plataformas como:

* TikTok
* Instagram Reels
* YouTube Shorts

---

# 🛡️ YouTube

O download utiliza `yt-dlp`.

O YouTube pode aplicar mecanismos de:

* autenticação;
* CAPTCHA;
* bloqueio por IP;
* restrições de cliente;
* cookies;
* PO Tokens.

O projeto tenta lidar com esses cenários de forma automatizada sempre que possível.

O OPUS-COPY não solicita que o usuário envie arquivos de cookies para o projeto.

---

# 🧪 Testes

O projeto deve diferenciar claramente:

### Testes executados

* Importação dos módulos
* Dependências
* yt-dlp
* FFmpeg
* ffprobe
* WhisperX
* Renderização
* Pipeline

### Testes dependentes do ambiente

Alguns testes dependem do Windows, navegador, rede, conta do YouTube ou disponibilidade das APIs.

Esses testes não devem ser considerados aprovados sem execução real.

---

# ⚠️ Status do projeto

**Em desenvolvimento ativo.**

O objetivo atual é tornar todo o pipeline confiável para uso real:

```text
Download
   ↓
Transcrição
   ↓
Análise IA
   ↓
Seleção
   ↓
Corte
   ↓
Reframe 9:16
   ↓
Legendas
   ↓
MP4 final
```

---

# 🧭 Roadmap

## v0.1

* [x] Aplicação desktop
* [x] Interface PySide6
* [x] Download com yt-dlp
* [x] Transcrição com WhisperX
* [x] Análise de clips
* [x] Renderização FFmpeg
* [x] Tratamento de erros

## v0.2

* [ ] Melhorar seleção viral
* [ ] Melhorar reframe automático
* [ ] Mais estilos de legenda
* [ ] Preview dos clips
* [ ] Histórico de projetos
* [ ] Melhor tratamento de YouTube

## v0.3

* [ ] Exportação em lote
* [ ] Templates de legendas
* [ ] Detecção de rosto
* [ ] Tracking de sujeito
* [ ] Presets para TikTok / Reels / Shorts
* [ ] Empacotamento `.exe`

---

# 🎨 Identidade

O OPUS-COPY utiliza uma identidade visual escura e minimalista, com uma marca baseada em um **M formado por fumaça**, representando criatividade, mídia e transformação de conteúdo.

---

# 📌 Filosofia do projeto

O objetivo do OPUS-COPY é transformar:

> **1 vídeo longo → vários clips relevantes → conteúdo pronto para publicação**

A prioridade do projeto é **qualidade e confiabilidade**, não apenas automação.

Nenhum recurso deve ser considerado concluído apenas porque o código foi escrito. Sempre que possível, ele precisa ser validado por um teste real.

---

# 📄 Licença

Este projeto ainda não possui uma licença pública definida.

---

## OPUS-COPY

**Turn long videos into clips worth watching.**
