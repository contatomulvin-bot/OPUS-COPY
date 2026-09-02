from __future__ import annotations

from pathlib import Path

from .tools import ToolError, require_executable, run_process


class YouTubeDownloader:
    """Download one YouTube video with yt-dlp and resilient 403 retries."""

    def __init__(self) -> None:
        self.executable = require_executable("yt-dlp")

    @staticmethod
    def _is_403(text: str) -> bool:
        lowered = text.lower()
        return "403" in lowered or "forbidden" in lowered or "http error 403" in lowered

    def _run_download(self, url: str, output_dir: Path, cookies_browser: str | None = None):
        # Do not force a custom YouTube format. yt-dlp's own format selection is
        # more resilient to changes in YouTube's available streams/signatures.
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

    def download(self, url: str, output_dir: Path, progress_callback=None) -> Path:
        clean_url = url.strip()
        if not clean_url:
            raise ToolError("Informe uma URL do YouTube.")
        if not (clean_url.startswith("https://") or clean_url.startswith("http://")):
            raise ToolError("Informe uma URL completa do YouTube (https://...).")

        output_dir.mkdir(parents=True, exist_ok=True)

        attempts: list[str | None] = [None]
        # A logged-in browser session can solve YouTube's age/login/anti-bot
        # challenge when a plain yt-dlp request receives HTTP 403. Try Brave
        # first because it is a common Chromium browser on Windows, then Chrome.
        attempts.extend(["brave", "chrome"])
        errors: list[str] = []

        for browser in attempts:
            # Remove stale partial outputs between retries so we never select a
            # half-downloaded file as the successful result.
            for partial in output_dir.glob("source.*"):
                if partial.is_file():
                    try:
                        partial.unlink()
                    except OSError:
                        pass

            result = self._run_download(clean_url, output_dir, browser)
            combined = "\n".join(part for part in (result.stdout, result.stderr) if part).strip()
            if result.returncode == 0:
                candidates = sorted(
                    output_dir.glob("source.*"),
                    key=lambda p: p.stat().st_mtime,
                    reverse=True,
                )
                videos = [
                    p for p in candidates
                    if p.suffix.lower() in {".mp4", ".mkv", ".webm", ".mov"}
                    and p.stat().st_size > 0
                ]
                if videos:
                    return videos[0]
                errors.append("yt-dlp terminou sem produzir um arquivo de vídeo.")
                continue

            if browser is None and self._is_403(combined):
                errors.append("Tentativa sem cookies retornou HTTP 403; tentando sessão do navegador.")
                continue

            if browser is not None and self._is_403(combined):
                errors.append(f"Tentativa com cookies do {browser} retornou HTTP 403.")
                continue

            # Non-403 errors are not helped by changing browser cookies; return
            # the real yt-dlp diagnostic immediately.
            raise ToolError(
                "Falha no download do YouTube.\n\n"
                f"{combined or 'yt-dlp encerrou sem informar o erro.'}"
            )

        details = "\n".join(errors)
        raise ToolError(
            "O YouTube recusou o download com HTTP 403 mesmo após tentar "
            "uma sessão normal e cookies do navegador.\n\n"
            f"{details}\n\n"
            "Abra o YouTube no Brave/Chrome, confirme que o vídeo reproduz "
            "normalmente e tente novamente."
        )
