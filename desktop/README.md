# OPUS-COPY Desktop

Primeira versão do aplicativo desktop em Python/PySide6.

## Windows

No PowerShell, na raiz do repositório:

```powershell
.\desktop\setup.ps1
```

Depois:

```powershell
.\desktop\run.ps1
```

O aplicativo usa localmente:

- yt-dlp para obter o vídeo do YouTube;
- FFmpeg para mídia e renderização;
- WhisperX para transcrição com timestamps de palavras;
- Gemini para selecionar e pontuar os melhores momentos;
- PySide6 para a interface desktop.

Defina `GEMINI_API_KEY` no `.env` para habilitar a análise por IA. O processamento de WhisperX usa CPU por padrão para manter compatibilidade com Windows + AMD; `WHISPERX_DEVICE` e `WHISPERX_MODEL` podem ser ajustados por ambiente.

A versão atual é o núcleo funcional inicial. O próximo estágio é adicionar fila de jobs, prévia dos clips, escolha manual dos candidatos, tracking automático de rosto para reframe e empacotamento em instalador `.exe`.
