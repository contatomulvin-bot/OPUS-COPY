from __future__ import annotations

from pathlib import Path

from .tools import ToolError, ensure_parent, require_executable, run_process


class YouTubeDownloader:
    def __init__(self) -> None:
        self.executable = require_executable("yt-dlp")

    def download(self, url: str, output_dir: Path, progress_callback=None) -> Path:
        if not url.strip():
            raise ToolError("Informe uma URL do YouTube.")
        output_dir.mkdir(parents=True, exist_ok=True)
        template = str(output_dir / "source.%(ext)s")
        args = [
            self.executable,
            "--no-playlist",
            "--no-warnings",
            "--newline",
            "--merge-output-format", "mp4",
            "-o", template,
            url.strip(),
        ]
        result = run_process(args, timeout=6 * 60 * 60)
        if result.returncode != 0:
            raise ToolError(
                "Falha no download do YouTube.\n\n"
                f"{(result.stderr or result.stdout).strip()}"
            )

        candidates = sorted(output_dir.glob("source.*"), key=lambda p: p.stat().st_mtime, reverse=True)
        videos = [p for p in candidates if p.suffix.lower() in {".mp4", ".mkv", ".webm", ".mov"}]
        if not videos:
            raise ToolError("O yt-dlp terminou sem produzir um arquivo de vídeo.")
        return videos[0]
