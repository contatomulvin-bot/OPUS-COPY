from __future__ import annotations

import traceback
from pathlib import Path

from .analyzer import ViralAnalyzer
from .downloader import YouTubeDownloader
from .renderer import ClipRenderer
from .tools import ToolError, free_space_gb
from .transcriber import WhisperXTranscriber, save_transcript


class Pipeline:
    def __init__(self, workspace: Path) -> None:
        self.workspace = workspace

    def run(self, url: str, max_clips: int = 5, progress=None) -> list[Path]:
        self.workspace.mkdir(parents=True, exist_ok=True)
        if free_space_gb(self.workspace) < 5:
            raise ToolError("Pouco espaço livre. Libere pelo menos 5 GB antes de processar um vídeo.")

        def report(message: str):
            if progress:
                progress(message)

        report("Verificando yt-dlp e baixando o vídeo…")
        source = YouTubeDownloader().download(url, self.workspace / "source")
        report(f"Vídeo baixado: {source.name}")

        report("Transcrevendo com WhisperX local…")
        transcript = WhisperXTranscriber().transcribe(source, language="pt")
        save_transcript(transcript, self.workspace / "transcript.json")
        report("Transcrição concluída.")

        report("A IA está avaliando os melhores momentos…")
        clips = ViralAnalyzer().rank(transcript, max_clips=max_clips)
        if not clips:
            raise ToolError("A IA não encontrou clips válidos na transcrição.")
        report("Momentos encontrados: " + ", ".join(f"{c.score:.0f}/100" for c in clips))

        report("Renderizando clips verticais 9:16 com legendas…")
        output_dir = self.workspace / "clips"
        renderer = ClipRenderer()
        outputs = []
        for index, clip in enumerate(clips, 1):
            output = output_dir / f"clip_{index:02d}_{clip.score:.0f}.mp4"
            renderer.render(source, clip, transcript, output)
            outputs.append(output)
            report(f"Clip {index}/{len(clips)} pronto: {output.name}")

        return outputs
