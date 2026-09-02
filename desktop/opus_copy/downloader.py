from __future__ import annotations

import os
from pathlib import Path

from .tools import ToolError, require_executable, run_process


class YouTubeDownloader:
    """Download one YouTube video with yt-dlp and browser-session fallbacks."""

    def __init__(self) -> None:
        self.executable = require_executable("yt-dlp")

    @staticmethod
    def _is_blocked(text: str) -> bool:
        lowered = text.lower()
        markers = (
            "sign in to confirm",
            "you're not a bot",
            "you’re not a bot",
            "login_required",
            "http error 403",
            "403 forbidden",
        )
        return any(marker in lowered for marker in markers)

    def _run_download(
        self,
        url: str,
        output_dir: Path,
        cookies_browser: str | None = None,
    ):
        # Prefer clients that are currently less affected by YouTube's
        # web/PO-token enforcement. Do not force a format: yt-dlp chooses a
        # compatible stream and merges it with FFmpeg when necessary.
        template = str(output_dir / "source.%(ext)s")
        args = [
            self.executable,
            "--no-playlist",
            "--newline",
            "--no-warnings",
            "--no-part",
            "--extractor-args", "youtube:player_client=tv,web_embedded,web",
            "--merge-output-format", "mp4",
            "-o", template,
        ]
        if cookies_browser:
            args.extend(["--cookies-from-browser", cookies_browser])
        args.append(url)
        return run_process(args, timeout=6 * 60 * 60)

    @staticmethod
    def _remove_stale_outputs(output_dir: Path) -> None:
        for partial in output_dir.glob("source.*"):
            if partial.is_file():
                try:
                    partial.unlink()
                except OSError:
                    pass

    def _find_video(self, output_dir: Path) -> Path | None:
        candidates = sorted(
            output_dir.glob("source.*"),
            key=lambda p: p.stat().st_mtime,
            reverse=True,
        )
        videos = [
            p
            for p in candidates
            if p.suffix.lower() in {".mp4", ".mkv", ".webm", ".mov"}
            and p.stat().st_size > 0
        ]
        return videos[0] if videos else None

    def download(self, url: str, output_dir: Path, progress_callback=None) -> Path:
        clean_url = url.strip()
        if not clean_url:
            raise ToolError("Informe uma URL do YouTube.")
        if not (clean_url.startswith("https://") or clean_url.startswith("http://")):
            raise ToolError("Informe uma URL completa do YouTube (https://...).")

        output_dir.mkdir(parents=True, exist_ok=True)

        # User can override the browser order. By default we try a normal
        # request, then the logged-in Brave/Chrome sessions. Browser cookies
        # are the supported yt-dlp workaround for YouTube login/anti-bot checks.
        configured = os.getenv("OPUS_COPY_YOUTUBE_COOKIES_BROWSER", "").strip()
        if configured:
            browsers = [b.strip() for b in configured.split(",") if b.strip()]
        else:
            browsers = ["brave", "chrome"]

        attempts: list[str | None] = [None, *browsers]
        errors: list[str] = []

        for browser in attempts:
            self._remove_stale_outputs(output_dir)
            result = self._run_download(clean_url, output_dir, browser)
            combined = "\n".join(
                part for part in (result.stdout, result.stderr) if part
            ).strip()

            if result.returncode == 0:
                video = self._find_video(output_dir)
                if video:
                    return video
                errors.append("yt-dlp terminou sem produzir um arquivo de vídeo.")
                continue

            if self._is_blocked(combined):
                label = "sem cookies" if browser is None else f"cookies do {browser}"
                errors.append(f"YouTube bloqueou a tentativa com {label}.")
                continue

            # Non-authentication errors are not helped by trying other browser
            # sessions, so expose the real yt-dlp diagnostic immediately.
            raise ToolError(
                "Falha no download do YouTube.\n\n"
                f"{combined or 'yt-dlp encerrou sem informar o erro.'}"
            )

        details = "\n".join(errors)
        raise ToolError(
            "O YouTube recusou o download com uma verificação anti-bot/login.\n\n"
            f"{details}\n\n"
            "Abra o vídeo no Brave ou Chrome e confirme que ele reproduz "
            "normalmente. Se o navegador usado pelo OPUS-COPY não tiver uma "
            "sessão válida, feche o navegador e tente novamente."
        )
