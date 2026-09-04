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
- OpenCV para detectar e acompanhar rostos, incluindo rostos de perfil;
- WhisperX para transcrição com timestamps de palavras;
- Gemini para selecionar e pontuar os melhores momentos;
- PySide6 para a interface desktop.

Defina `GEMINI_API_KEY` no `.env` para habilitar a análise por IA. O processamento de WhisperX usa CPU por padrão para manter compatibilidade com Windows + AMD; `WHISPERX_DEVICE` e `WHISPERX_MODEL` podem ser ajustados por ambiente.

O reenquadramento vertical analisa o trecho em baixa resolução, acompanha o rosto mais consistente entre os frames, interpola detecções ausentes e envia ao FFmpeg uma trajetória suavizada. Se nenhum rosto for encontrado, o clip usa recorte central sem interromper a renderização.

Para equilibrar velocidade e precisão, podem ser ajustadas as variáveis `OPUS_COPY_FACE_SAMPLE_SECONDS` (padrão `0.40`) e `OPUS_COPY_FACE_MAX_SAMPLES` (padrão `120`).
