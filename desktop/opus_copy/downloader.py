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

    @staticmethod
    def _is_cookie_database_error(text: str) -> bool:
        lowered = text.lower()
        markers = (
            "could not copy chrome cookie database",
            "could not copy firefox cookie database",
            "could not copy edge cookie database",
            "could not copy opera cookie database",
            "could not copy chromium cookie database",
            "could not copy brave cookie database",
            "database is locked",
            "cookie database",
        )
        return any(marker in lowered for marker in markers)

    def _run_download(
        self,
        url: str,
        output_dir: Path,
        cookies_browser: str | None = None,
    ):
        # Do not force a YouTube client here. yt-dlp can select the available
        # client and stream formats itself; forcing clients can make some
        # videos fail because of client-specific restrictions/tokens.
        template = str(output_dir / "source.%(ext)s")
        args = [
            self.executable,
            "--no-playlist",
            "--newline",
            "--no-warnings",
            "--no-part",
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

        # The browser process can lock its Chromium cookie database. Trying
        # another browser in that situation is useful, but the cookie error
        # itself must not be mistaken for a YouTube anti-bot block.
        configured = os.getenv("OPUS_COPY_YOUTUBE_COOKIES_BROWSER", "").strip()
        if configured:
            browsers = [b.strip() for b in configured.split(",") if b.strip()]
        else:
            browsers = ["brave", "chrome", "edge"]

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

            if browser is not None and self._is_cookie_database_error(combined):
                errors.append(
                    f"Não foi possível ler o banco de cookies do {browser}. "
                    "Feche esse navegador e tente novamente."
                )
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
            "Não foi possível baixar este vídeo pelo YouTube.\n\n"
            f"{details}\n\n"
            "Para usar cookies, feche completamente o Brave/Chrome/Edge e "
            "tente novamente. O OPUS-COPY não precisa que você envie seu "
            "arquivo de cookies."
        )
