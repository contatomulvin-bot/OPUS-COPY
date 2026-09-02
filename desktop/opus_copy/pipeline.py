from __future__ import annotations

import hashlib
import json
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

from .analyzer import ViralAnalyzer
from .downloader import YouTubeDownloader
from .renderer import ClipRenderer
from .tools import ToolError, free_space_gb
from .transcriber import WhisperXTranscriber, save_transcript


class Pipeline:
    def __init__(self, workspace: Path) -> None:
        self.workspace = workspace

    @staticmethod
    def _source_signature(source: Path) -> str:
        stat = source.stat()
        raw = f"{source.resolve()}|{stat.st_size}|{stat.st_mtime_ns}".encode("utf-8")
        return hashlib.sha256(raw).hexdigest()

    def _load_cached_transcript(self, source: Path, path: Path) -> dict | None:
        meta_path = path.with_suffix(".meta.json")
        if not path.is_file() or not meta_path.is_file():
            return None
        try:
            meta = json.loads(meta_path.read_text(encoding="utf-8"))
            if meta.get("source_signature") != self._source_signature(source):
                return None
            return json.loads(path.read_text(encoding="utf-8"))
        except (OSError, ValueError, TypeError):
            return None

    def _save_cached_transcript(self, source: Path, transcript: dict, path: Path) -> None:
        save_transcript(transcript, path)
        meta_path = path.with_suffix(".meta.json")
        meta_path.write_text(
            json.dumps({"source_signature": self._source_signature(source)}, indent=2),
            encoding="utf-8",
        )

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

        transcript_path = self.workspace / "transcript.json"
        transcript = self._load_cached_transcript(source, transcript_path)
        if transcript is not None:
            report("Transcrição em cache encontrada — pulando WhisperX.")
        else:
            report("Transcrevendo com WhisperX local…")
            transcript = WhisperXTranscriber().transcribe(source, language="pt")
            self._save_cached_transcript(source, transcript, transcript_path)
            report("Transcrição concluída.")

        report("A IA está avaliando os melhores momentos…")
        clips = ViralAnalyzer().rank(transcript, max_clips=max_clips)
        if not clips:
            raise ToolError("A IA não encontrou clips válidos na transcrição.")
        report("Momentos encontrados: " + ", ".join(f"{c.score:.0f}/100" for c in clips))

        report("Renderizando clips verticais 9:16 com legendas…")
        output_dir = self.workspace / "clips"
        renderer = ClipRenderer()
        outputs: list[Path] = [output_dir / f"clip_{index:02d}_{clip.score:.0f}.mp4" for index, clip in enumerate(clips, 1)]

        workers = max(1, min(int(__import__("os").environ.get("OPUS_COPY_RENDER_WORKERS", "2")), len(clips)))

        def render_one(index: int, clip, output: Path) -> Path:
            if output.is_file() and output.stat().st_size > 0:
                return output
            return renderer.render(source, clip, transcript, output)

        with ThreadPoolExecutor(max_workers=workers, thread_name_prefix="opus-render") as executor:
            futures = {
                executor.submit(render_one, index, clip, output): (index, output)
                for index, (clip, output) in enumerate(zip(clips, outputs), 1)
            }
            completed = 0
            for future in as_completed(futures):
                index, output = futures[future]
                future.result()
                completed += 1
                report(f"Clip {completed}/{len(clips)} pronto: {output.name}")

        return outputs
