<img width="1240" height="888" alt="image" src="https://github.com/user-attachments/assets/f8de1e86-0bf0-42fe-b534-183360bce287" />

# OPUS-COPY

> **AI-powered desktop video clipper for Windows**

Transforme vídeos longos em clips verticais prontos para publicação — com **transcrição local rápida, seleção inteligente, ganchos e palavras-chave pensados para audiência no YouTube**.

O **OPUS-COPY** é um aplicativo desktop desenvolvido para encontrar automaticamente os melhores momentos de vídeos longos usando IA, gerar cortes, adicionar legendas e preparar conteúdo em formato vertical 9:16.

---

## ✨ Recursos

* 🎥 Download de vídeos do YouTube
* 🤖 Análise automática dos melhores momentos com IA
* ⚡ Transcrição local com **faster-whisper**
* 🧠 Timestamps por palavra sem uma segunda etapa de alinhamento WhisperX
* 🌎 Seleção do idioma de transcrição
* ✂️ Geração automática de clips
* 🎯 Ranking por potencial de retenção e força do gancho
* 🪝 Geração de **hooks/ganchos** para aumentar o interesse inicial
* 🔎 Geração de **palavras-chave relacionadas ao YouTube**
* 📊 Score detalhado de cada oportunidade
* 📱 Conversão para formato vertical 9:16
* 📝 Legendas automáticas
* 🎬 Processamento com FFmpeg
* ⚡ Processamento em segundo plano sem travar a interface
* 💾 Cache de transcrições para evitar processamento repetido
* 🚀 Download e renderização de clips em paralelo
* 🧹 Gerenciamento de arquivos temporários
* 📋 Diagnóstico detalhado de erros
* 🧩 Suporte a PO Token Provider para o ecossistema atual do YouTube
* 🖥️ Preparação para distribuição como aplicativo Windows `.exe`

---

## 🧠 Como funciona

```text
YouTube URL
     │
     ▼
┌──────────────┐
│    yt-dlp    │
│    Download  │
└──────┬───────┘
       │
       ▼
┌──────────────────┐
│  faster-whisper  │
│ Transcrição local│
│ + word timestamps│
└──────┬───────────┘
       │
       ▼
┌─────────────────────┐
│         IA          │
│ Hook + Retenção     │
│ Curiosidade + Valor │
│ Keywords YouTube    │
└─────────┬───────────┘
          │
          ▼
┌──────────────┐
│ Clip Selection│
│ Score / Rank  │
└──────┬───────┘
       │
       ▼
┌──────────────┐
│    FFmpeg    │
│ Reframe 9:16 │
│ + Legendas   │
└──────┬───────┘
       │
       ▼
  MP4 9:16
  + Legendas
  + Metadados
```

---

## 🎯 Seleção orientada para audiência

O OPUS-COPY não procura apenas trechos interessantes. A IA avalia cada oportunidade pensando em **retenção e descoberta no YouTube**.

### ⚡ Critérios de ranking

| Critério | Peso |
| --- | ---: |
| 🪝 Força do gancho nos primeiros 3–5s | **30%** |
| 📈 Potencial de retenção | **20%** |
| 🤯 Curiosidade / surpresa | **15%** |
| ❤️ Emoção / identificação | **10%** |
| 💎 Valor / entretenimento | **10%** |
| 🔄 Potencial de compartilhamento | **10%** |
| 🎯 Clareza e contexto independente | **5%** |

### 🪝 Ganchos

A IA procura estruturas que naturalmente despertam interesse, como:

* perguntas fortes;
* revelações;
* contradições;
* opiniões fortes;
* histórias incomuns;
* erros e consequências;
* descobertas;
* números relevantes;
* segredos ou informações inesperadas;
* promessas e conflitos.

O sistema **não deve inventar fatos** nem transformar um trecho em clickbait enganoso. O gancho precisa representar o conteúdo real do clip.

### 🔎 Palavras-chave para YouTube

Cada clip pode receber de **3 a 8 palavras-chave/frases relacionadas ao assunto**, priorizando termos que façam sentido para descoberta e pesquisa no YouTube.

Exemplo conceitual:

```text
Título: O erro que quase todo iniciante comete

Hook: "Esse erro parece pequeno, mas pode acabar com seu resultado."

Keywords:
- erros de iniciantes
- dicas para iniciantes
- como começar
- erros comuns
- tutorial
```

As palavras-chave são geradas a partir do conteúdo real da transcrição e não devem ser adicionadas apenas para parecerem virais.

---

## ⚡ Transcrição rápida

O pipeline local utiliza **faster-whisper** em vez de executar o fluxo completo do WhisperX.

Isso evita uma segunda etapa pesada de alinhamento quando os timestamps por palavra já são suficientes para o sistema de legendas.

O modelo é carregado e reutilizado durante a execução, e as transcrições podem ser armazenadas em cache para evitar processamento desnecessário.

### Dispositivo

O backend detecta automaticamente o dispositivo compatível com o runtime instalado:

```env
WHISPER_DEVICE=auto
WHISPER_MODEL=small
WHISPER_COMPUTE_TYPE=int8
```

Também é possível configurar explicitamente:

```env
WHISPER_DEVICE=cpu
```

ou, em ambientes com suporte CUDA compatível:

```env
WHISPER_DEVICE=cuda
WHISPER_COMPUTE_TYPE=float16
```

> **Nota:** CUDA é destinado a GPUs NVIDIA. Em Windows com GPUs AMD, o projeto utiliza um fallback compatível em vez de assumir que CUDA estará disponível.

---

## 🛠️ Tecnologias

| Tecnologia | Função |
| ---------- | ------- |
| Python | Backend e pipeline |
| PySide6 | Interface desktop |
| yt-dlp | Download de vídeos |
| faster-whisper | Transcrição local |
| Gemini | Análise de clips e audiência |
| FFmpeg | Edição e renderização |
| SQLite | Persistência local |
| PowerShell | Setup e execução no Windows |
| PyInstaller | Empacotamento Windows |

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
* faster-whisper
* FFmpeg
* ffprobe
* Google Gemini SDK
* PO Token Provider
* PyInstaller

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

Opcionalmente, para configurar a transcrição:

```env
WHISPER_DEVICE=auto
WHISPER_MODEL=small
WHISPER_COMPUTE_TYPE=int8
```

Nunca publique sua API key no GitHub.

---

# 📁 Metadados gerados

Durante o processamento, o OPUS-COPY pode gerar:

```text
analysis/
├── transcript_pt_faster_whisper_v2.json
└── clip_metadata.json
```

O `clip_metadata.json` guarda informações como:

```json
{
  "rank": 1,
  "score": 94,
  "title": "Título sugerido",
  "hook": "Gancho do clip",
  "category": "EDUCATION",
  "keywords": [
    "palavra-chave 1",
    "palavra-chave 2"
  ],
  "scores": {
    "hook": 96,
    "retention": 93,
    "curiosity": 90
  }
}
```

Isso permite que a interface futuramente mostre não apenas o vídeo selecionado, mas **por que a IA escolheu aquele momento**.

---

# 📱 Saída

Os clips são preparados para conteúdo vertical:

```text
Formato: MP4
Aspect ratio: 9:16
Vídeo: H.264
Áudio: AAC
Legendas: automáticas
```

A ideia é gerar vídeos compatíveis com:

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
* faster-whisper
* Renderização
* Pipeline

### Testes dependentes do ambiente

Alguns testes dependem do Windows, GPU, navegador, rede, conta do YouTube ou disponibilidade das APIs.

Esses testes não devem ser considerados aprovados sem execução real.

---

# ⚠️ Status do projeto

**Em desenvolvimento ativo.**

O objetivo atual é tornar todo o pipeline confiável para uso real:

```text
Download
   ↓
Transcrição local
   ↓
Análise IA
   ↓
Hook + Keywords
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
* [x] Pipeline de transcrição
* [x] Transcrição local com faster-whisper
* [x] Timestamps por palavra
* [x] Análise de clips
* [x] Ranking de potencial de retenção
* [x] Geração de hooks
* [x] Geração de palavras-chave para YouTube
* [x] Renderização FFmpeg
* [x] Tratamento de erros

## v0.2

* [ ] Melhorar seleção viral
* [ ] Melhorar reframe automático
* [ ] Mais estilos de legenda
* [ ] Preview dos clips
* [ ] Histórico de projetos
* [ ] Barra de progresso com ETA mais precisa
* [ ] Melhor tratamento de YouTube
* [ ] Interface com estética mais refinada

## v0.3

* [ ] Exportação em lote
* [ ] Templates de legendas
* [ ] Detecção de rosto
* [ ] Tracking de sujeito
* [ ] Presets para TikTok / Reels / Shorts
* [ ] Empacotamento `.exe` final
* [ ] Download/gerenciamento automático de modelos
* [ ] Otimizações específicas para GPUs AMD

---

# 🎨 Identidade

O OPUS-COPY utiliza uma identidade visual escura e minimalista, com uma marca baseada em um **M formado por fumaça**, representando criatividade, mídia e transformação de conteúdo.

---

# 📌 Filosofia do projeto

O objetivo do OPUS-COPY é transformar:

> **1 vídeo longo → vários clips relevantes → hooks fortes → conteúdo pronto para publicação**

A prioridade do projeto é **qualidade, retenção e confiabilidade**, não apenas automação.

Nenhum recurso deve ser considerado concluído apenas porque o código foi escrito. Sempre que possível, ele precisa ser validado por um teste real.

---

# 📄 Licença

Este projeto ainda não possui uma licença pública definida.

---

## OPUS-COPY

**Turn long videos into clips worth watching.**
