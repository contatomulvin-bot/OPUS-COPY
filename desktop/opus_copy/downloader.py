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
            "could not find chrome cookies database",
            "could not find firefox cookies database",
            "could not find edge cookies database",
            "could not find opera cookies database",
            "could not find chromium cookies database",
            "could not find brave cookies database",
            "database is locked",
            "cookie database",
        )
        return any(marker in lowered for marker in markers)

    @staticmethod
    def _windows_browser_profiles() -> list[tuple[str, str]]:
        """Find real Chromium browser profiles on Windows."""
        local = Path(os.getenv("LOCALAPPDATA", ""))
        roaming = Path(os.getenv("APPDATA", ""))
        candidates = (
            ("brave", local / "BraveSoftware" / "Brave-Browser" / "User Data"),
            ("chrome", local / "Google" / "Chrome" / "User Data"),
            ("edge", local / "Microsoft" / "Edge" / "User Data"),
            ("chromium", local / "Chromium" / "User Data"),
            ("vivaldi", local / "Vivaldi" / "User Data"),
            ("opera", roaming / "Opera Software" / "Opera Stable"),
        )

        found: list[tuple[str, str]] = []
        for browser, root in candidates:
            if not root.is_dir():
                continue
            try:
                children = list(root.iterdir())
            except OSError:
                continue
            profiles: list[Path] = []
            for child in children:
                if not child.is_dir():
                    continue
                if (child / "Network" / "Cookies").is_file() or (child / "Cookies").is_file():
                    profiles.append(child)
            if not profiles and ((root / "Network" / "Cookies").is_file() or (root / "Cookies").is_file()):
                profiles.append(root)
            profiles.sort(key=lambda p: (p.name != "Default", p.name.lower()))
            found.extend((browser, str(profile)) for profile in profiles)

        unique: list[tuple[str, str]] = []
        seen: set[tuple[str, str]] = set()
        for item in found:
            if item not in seen:
                seen.add(item)
                unique.append(item)
        return unique

    @staticmethod
    def _browser_attempts() -> list[tuple[str, str]]:
        configured = os.getenv("OPUS_COPY_YOUTUBE_COOKIES_BROWSER", "").strip()
        if not configured:
            return YouTubeDownloader._windows_browser_profiles()
        attempts: list[tuple[str, str]] = []
        for raw in configured.split(","):
            value = raw.strip()
            if not value:
                continue
            if ":" in value:
                browser, profile = value.split(":", 1)
                attempts.append((browser.strip(), profile.strip()))
            else:
                attempts.append((value, ""))
        return attempts

    @staticmethod
    def _pot_provider_home() -> Path | None:
        configured = os.getenv("OPUS_COPY_POT_PROVIDER_HOME", "").strip()
        root = Path(configured).expanduser() if configured else Path(os.getenv("USERPROFILE", "")) / "bgutil-ytdlp-pot-provider"
        server = root / "server"
        if (server / "package.json").is_file() and (server / "src").is_dir():
            return server
        return None

    def _run_download(self, url: str, output_dir: Path, cookies_browser: str | None = None):
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
        provider_home = self._pot_provider_home()
        if provider_home:
            args.extend(["--extractor-args", f"youtubepot-bgutilscript:server_home={provider_home}"])
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
        candidates = sorted(output_dir.glob("source.*"), key=lambda p: p.stat().st_mtime, reverse=True)
        videos = [p for p in candidates if p.suffix.lower() in {".mp4", ".mkv", ".webm", ".mov"} and p.stat().st_size > 0]
        return videos[0] if videos else None

    def _find_cached_video(self, url: str, output_dir: Path) -> Path | None:
        marker = output_dir / "source.url"
        video = self._find_video(output_dir)
        if not marker.is_file() or video is None:
            return None
        try:
            saved_url = marker.read_text(encoding="utf-8").strip()
        except OSError:
            return None
        return video if saved_url == url else None

    def download(self, url: str, output_dir: Path, progress_callback=None) -> Path:
        clean_url = url.strip()
        if not clean_url:
            raise ToolError("Informe uma URL do YouTube.")
        if not (clean_url.startswith("https://") or clean_url.startswith("http://")):
            raise ToolError("Informe uma URL completa do YouTube (https://...).")

        output_dir.mkdir(parents=True, exist_ok=True)
        cached = self._find_cached_video(clean_url, output_dir)
        if cached:
            return cached

        browser_attempts = self._browser_attempts()
        attempts: list[tuple[str, str | None]] = [("sem cookies", None)]
        attempts.extend(
            (f"cookies do {browser} ({profile})" if profile else f"cookies do {browser}", f"{browser}:{profile}" if profile else browser)
            for browser, profile in browser_attempts
        )

        errors: list[str] = []
        for label, browser_arg in attempts:
            self._remove_stale_outputs(output_dir)
            result = self._run_download(clean_url, output_dir, browser_arg)
            combined = "\n".join(part for part in (result.stdout, result.stderr) if part).strip()

            if result.returncode == 0:
                video = self._find_video(output_dir)
                if video:
                    (output_dir / "source.url").write_text(clean_url + "\n", encoding="utf-8")
                    return video
                errors.append("yt-dlp terminou sem produzir um arquivo de vídeo.")
                continue

            if browser_arg is not None and self._is_cookie_database_error(combined):
                errors.append(f"{label}: banco de cookies não pôde ser lido.")
                continue
            if self._is_blocked(combined):
                errors.append(f"YouTube bloqueou a tentativa com {label}.")
                continue
            raise ToolError("Falha no download do YouTube.\n\n" f"{combined or 'yt-dlp encerrou sem informar o erro.'}")

        details = "\n".join(errors)
        detected = ", ".join(label for label, _ in attempts[1:]) or "nenhum perfil de navegador"
        provider = self._pot_provider_home()
        provider_text = f"PO Token Provider detectado em: {provider}" if provider else "PO Token Provider não foi encontrado neste PC. Execute .\\desktop\\setup.ps1 para instalá-lo."
        raise ToolError(
            "Não foi possível baixar este vídeo pelo YouTube.\n\n"
            f"{details}\n\n"
            f"Perfis de navegador detectados: {detected}.\n"
            f"{provider_text}"
        )
