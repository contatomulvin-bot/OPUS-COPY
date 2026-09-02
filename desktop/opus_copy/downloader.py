from __future__ import annotations

import os
from pathlib import Path

from .tools import ToolError, require_executable, run_process


class YouTubeDownloader:
    """YouTube downloader with cache, audio-first analysis and section downloads."""

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
            profiles = [
                child for child in children
                if child.is_dir()
                and ((child / "Network" / "Cookies").is_file() or (child / "Cookies").is_file())
            ]
            if not profiles and ((root / "Network" / "Cookies").is_file() or (root / "Cookies").is_file()):
                profiles = [root]
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

    def _base_args(self) -> list[str]:
        args = [self.executable, "--no-playlist", "--newline", "--no-warnings", "--no-part"]
        provider_home = self._pot_provider_home()
        if provider_home:
            args.extend(["--extractor-args", f"youtubepot-bgutilscript:server_home={provider_home}"])
        return args

    def _run(self, args: list[str], timeout: int = 6 * 60 * 60):
        return run_process(args, timeout=timeout)

    def _run_with_browser_fallbacks(self, build_args, output_dir: Path, success_check, purpose: str) -> Path:
        output_dir.mkdir(parents=True, exist_ok=True)
        browsers = self._browser_attempts()
        attempts: list[tuple[str, str | None]] = [("sem cookies", None)]
        attempts.extend(
            (
                f"cookies do {browser} ({profile})" if profile else f"cookies do {browser}",
                f"{browser}:{profile}" if profile else browser,
            )
            for browser, profile in browsers
        )
        errors: list[str] = []
        for label, browser_arg in attempts:
            result = self._run(build_args(browser_arg), timeout=6 * 60 * 60)
            combined = "\n".join(part for part in (result.stdout, result.stderr) if part).strip()
            if result.returncode == 0:
                path = success_check()
                if path:
                    return path
                errors.append(f"{label}: yt-dlp terminou sem criar o arquivo esperado.")
                continue
            if browser_arg is not None and self._is_cookie_database_error(combined):
                errors.append(f"{label}: banco de cookies não pôde ser lido.")
                continue
            if self._is_blocked(combined):
                errors.append(f"YouTube bloqueou {purpose} com {label}.")
                continue
            raise ToolError(f"Falha no {purpose} do YouTube.\n\n{combined or 'yt-dlp encerrou sem informar o erro.'}")
        provider = self._pot_provider_home()
        provider_text = f"PO Token Provider detectado em: {provider}" if provider else "PO Token Provider não encontrado. Execute .\\desktop\\setup.ps1."
        raise ToolError("Não foi possível concluir o " + purpose + " pelo YouTube.\n\n" + "\n".join(errors) + f"\n\n{provider_text}")

    def download_audio(self, url: str, output_dir: Path, output: Path | None = None) -> Path:
        clean_url = url.strip()
        if not clean_url:
            raise ToolError("Informe uma URL do YouTube.")
        output_dir.mkdir(parents=True, exist_ok=True)
        output = output or (output_dir / "analysis_audio.%(ext)s")
        final_candidates = list(output_dir.glob("analysis_audio.*"))
        if final_candidates:
            newest = max((p for p in final_candidates if p.is_file() and p.stat().st_size > 0), key=lambda p: p.stat().st_mtime, default=None)
            if newest:
                return newest

        def build(browser_arg: str | None) -> list[str]:
            args = self._base_args() + ["-f", "ba/b", "-x", "--audio-format", "m4a", "-o", str(output)]
            if browser_arg:
                args.extend(["--cookies-from-browser", browser_arg])
            args.append(clean_url)
            return args

        def check() -> Path | None:
            paths = [p for p in output_dir.glob("analysis_audio.*") if p.is_file() and p.stat().st_size > 0]
            return max(paths, key=lambda p: p.stat().st_mtime) if paths else None

        return self._run_with_browser_fallbacks(build, output_dir, check, "download do áudio")

    def download_section(self, url: str, output_dir: Path, index: int, clip) -> Path:
        clean_url = url.strip()
        output_dir.mkdir(parents=True, exist_ok=True)
        stem = f"section_{index:02d}"
        existing = sorted([p for p in output_dir.glob(stem + ".*") if p.is_file() and p.stat().st_size > 0])
        if existing:
            return existing[0]

        start = max(0.0, float(clip.start))
        end = max(start + 0.1, float(clip.end))
        pattern = str(output_dir / f"{stem}.%(ext)s")

        def build(browser_arg: str | None) -> list[str]:
            args = self._base_args() + [
                "--download-sections", f"*{start:.3f}-{end:.3f}",
                "--merge-output-format", "mp4",
                "-o", pattern,
            ]
            if browser_arg:
                args.extend(["--cookies-from-browser", browser_arg])
            args.append(clean_url)
            return args

        def check() -> Path | None:
            candidates = [p for p in output_dir.glob(stem + ".*") if p.is_file() and p.suffix.lower() in {".mp4", ".mkv", ".webm", ".mov"} and p.stat().st_size > 0]
            return max(candidates, key=lambda p: p.stat().st_mtime) if candidates else None

        return self._run_with_browser_fallbacks(build, output_dir, check, f"download do trecho {index}")

    # Full-video download remains available as a compatibility/fallback path.
    def download(self, url: str, output_dir: Path, progress_callback=None) -> Path:
        clean_url = url.strip()
        if not clean_url:
            raise ToolError("Informe uma URL do YouTube.")
        output_dir.mkdir(parents=True, exist_ok=True)
        cached = self._find_cached_video(clean_url, output_dir)
        if cached:
            return cached

        def build(browser_arg: str | None) -> list[str]:
            args = self._base_args() + ["--merge-output-format", "mp4", "-o", str(output_dir / "source.%(ext)s")]
            if browser_arg:
                args.extend(["--cookies-from-browser", browser_arg])
            args.append(clean_url)
            return args

        result = self._run_with_browser_fallbacks(build, output_dir, lambda: self._find_video(output_dir), "download do vídeo")
        (output_dir / "source.url").write_text(clean_url + "\n", encoding="utf-8")
        return result

    def _find_video(self, output_dir: Path) -> Path | None:
        candidates = sorted(output_dir.glob("source.*"), key=lambda p: p.stat().st_mtime, reverse=True)
        return next((p for p in candidates if p.suffix.lower() in {".mp4", ".mkv", ".webm", ".mov"} and p.stat().st_size > 0), None)

    def _find_cached_video(self, url: str, output_dir: Path) -> Path | None:
        marker = output_dir / "source.url"
        video = self._find_video(output_dir)
        if not marker.is_file() or video is None:
            return None
        try:
            return video if marker.read_text(encoding="utf-8").strip() == url else None
        except OSError:
            return None
