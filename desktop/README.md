# OPUS-COPY Desktop

Primeira versão do aplicativo desktop em Python/PySide6.

## Windows

No PowerShell, na raiz do repositório:

```powershell
.\iniciar.ps1
```

Na primeira execução, esse comando cria o ambiente Python e instala as dependências. Depois disso, o mesmo comando abre o aplicativo diretamente. Se a política de execução do Windows bloquear o arquivo:

```powershell
powershell -ExecutionPolicy Bypass -File .\iniciar.ps1
```

O aplicativo usa localmente:

- yt-dlp para obter o vídeo do YouTube;
- FFmpeg para mídia e renderização;
- faster-whisper para transcrição com timestamps de palavras;
- Gemini para selecionar e pontuar os melhores momentos;
- PySide6 para a interface desktop.

Defina `GEMINI_API_KEY` no `.env` para habilitar a análise por IA. O dispositivo é detectado automaticamente; em uma instalação sem aceleração compatível, o faster-whisper volta para CPU. `WHISPER_DEVICE`, `WHISPER_MODEL` e `WHISPER_COMPUTE_TYPE` podem ser ajustados no ambiente.

A logo em `assets/opus-copy-logo.svg` é convertida automaticamente para um `.ico` com várias resoluções e aplicada à janela, à barra de tarefas do Windows e ao executável criado pelo PyInstaller.

Para criar o executável após a configuração:

```powershell
.\desktop\build.ps1
```

O resultado fica em `desktop\dist\OPUS-COPY\OPUS-COPY.exe`.
