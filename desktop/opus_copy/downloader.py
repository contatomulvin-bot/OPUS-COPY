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
        """Find real Chromium browser profiles on Windows.

        yt-dlp supports an explicit profile path in --cookies-from-browser.
        Supplying that path is more reliable than assuming the default browser
        data directory is present or using a browser name alone.
        """
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

            # Chromium stores cookies in the profile directory. Newer builds
            # normally use Network/Cookies; older builds may use Cookies.
            profiles: list[Path] = []
            for child in root.iterdir():
                if not child.is_dir():
                    continue
                if (
                    (child / "Network" / "Cookies").is_file()
                    or (child / "Cookies").is_file()
                ):
                    profiles.append(child)

            # Some browsers may point directly at a profile-like directory.
            if not profiles and (
                (root / "Network" / "Cookies").is_file()
                or (root / "Cookies").is_file()
            ):
                profiles.append(root)

            # Prefer Default first, then Profile N and any remaining profile.
            profiles.sort(key=lambda p: (p.name != "Default", p.name.lower()))
            for profile in profiles:
                found.append((browser, str(profile)))

        # De-duplicate while keeping deterministic order.
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

        # Always try a clean guest request first. If YouTube blocks it, use
        # actual browser profiles discovered on this Windows installation.
        browser_attempts = self._browser_attempts()
        attempts: list[tuple[str, str | None]] = [("sem cookies", None)]
        attempts.extend(
            (
                f"cookies do {browser} ({profile})" if profile else f"cookies do {browser}",
                f"{browser}:{profile}" if profile else browser,
            )
            for browser, profile in browser_attempts
        )

        errors: list[str] = []
        for label, browser_arg in attempts:
            self._remove_stale_outputs(output_dir)
            result = self._run_download(clean_url, output_dir, browser_arg)
            combined = "\n".join(
                part for part in (result.stdout, result.stderr) if part
            ).strip()

            if result.returncode == 0:
                video = self._find_video(output_dir)
                if video:
                    return video
                errors.append("yt-dlp terminou sem produzir um arquivo de vídeo.")
                continue

            if browser_arg is not None and self._is_cookie_database_error(combined):
                errors.append(f"{label}: banco de cookies não pôde ser lido.")
                continue

            if self._is_blocked(combined):
                errors.append(f"YouTube bloqueou a tentativa com {label}.")
                continue

            # Non-authentication errors are not helped by trying other browser
            # sessions, so expose the real yt-dlp diagnostic immediately.
            raise ToolError(
                "Falha no download do YouTube.\n\n"
                f"{combined or 'yt-dlp encerrou sem informar o erro.'}"
            )

        details = "\n".join(errors)
        detected = ", ".join(label for label, _ in attempts[1:]) or "nenhum perfil de navegador"
        raise ToolError(
            "Não foi possível baixar este vídeo pelo YouTube.\n\n"
            f"{details}\n\n"
            f"Perfis de navegador detectados: {detected}.\n"
            "O OPUS-COPY tenta automaticamente os perfis encontrados no Windows. "
            "Se todos forem bloqueados, o próximo passo é configurar um PO Token "
            "Provider para o yt-dlp, em vez de ficar trocando flags aleatórias."
        )
