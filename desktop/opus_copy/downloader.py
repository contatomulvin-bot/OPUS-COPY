from __future__ import annotations

import hashlib
import os
import shutil
from pathlib import Path

from .tools import ToolError, require_executable, run_process


class YouTubeDownloader:
    """YouTube downloader with safe per-clip caching and section downloads."""

    def __init__(self) -> None:
        self.executable = require_executable("yt-dlp")

    @staticmethod
    def _is_blocked(text: str) -> bool:
        lowered = text.lower()
        markers = (
            "sign in to confirm", "you're not a bot", "you’re not a bot",
            "login_required", "http error 403", "403 forbidden",
            "requested format is not available", "no formats found",
        )
        return any(marker in lowered for marker in markers)

    @staticmethod
    def _is_cookie_database_error(text: str) -> bool:
        lowered = text.lower()
        markers = (
            "could not copy chrome cookie database", "could not copy firefox cookie database",
            "could not copy edge cookie database", "could not copy opera cookie database",
            "could not copy chromium cookie database", "could not copy brave cookie database",
            "could not find chrome cookies database", "could not find firefox cookies database",
            "could not find edge cookies database", "could not find opera cookies database",
            "could not find chromium cookies database", "could not find brave cookies database",
            "database is locked", "cookie database", "failed to decrypt with dpapi",
        )
        return any(marker in lowered for marker in markers)

    @staticmethod
    def _browser_attempts() -> list[tuple[str, str]]:
        configured = os.getenv("OPUS_COPY_YOUTUBE_COOKIES_BROWSER", "").strip()
        if not configured:
            return []
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
    def _cookies_file() -> Path | None:
        configured = os.getenv("OPUS_COPY_YOUTUBE_COOKIES_FILE", "").strip()
        if not configured:
            return None
        path = Path(configured).expanduser()
        return path if path.is_file() else None

    @staticmethod
    def _js_runtime_args() -> list[str]:
        configured = os.getenv("OPUS_COPY_YOUTUBE_JS_RUNTIME", "").strip()
        if configured:
            return ["--js-runtimes", configured]
        deno = shutil.which("deno")
        if deno:
            return ["--js-runtimes", f"deno:{deno}"]
        node = shutil.which("node")
        if node:
            try:
                result = run_process([node, "--version"], timeout=10)
                version = (result.stdout or "").strip().lstrip("v")
                major = int(version.split(".", 1)[0]) if version else 0
            except (ValueError, OSError):
                major = 0
            if major >= 22:
                return ["--js-runtimes", f"node:{node}"]
        return []

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
        args.extend(self._js_runtime_args())
        provider_home = self._pot_provider_home()
        if provider_home:
            args.extend(["--extractor-args", f"youtubepot-bgutilscript:server_home={provider_home}"])
        return args

    def _run(self, args: list[str], timeout: int = 6 * 60 * 60):
        return run_process(args, timeout=timeout)

    def _run_with_browser_fallbacks(self, build_args, output_dir: Path, success_check, purpose: str) -> Path:
        output_dir.mkdir(parents=True, exist_ok=True)
        browsers = self._browser_attempts()
        cookie_file = self._cookies_file()
        attempts: list[tuple[str, str | None]] = [("sem cookies", None)]
        if cookie_file:
            attempts.append((f"cookies.txt ({cookie_file})", f"file:{cookie_file}"))
        attempts.extend((f"cookies do {browser} ({profile})" if profile else f"cookies do {browser}", f"{browser}:{profile}" if profile else browser) for browser, profile in browsers)
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
                errors.append(f"{label}: cookies não puderam ser lidos/descriptografados; tentando outra opção.")
                continue
            if self._is_blocked(combined):
                errors.append(f"YouTube bloqueou {purpose} com {label}.")
                continue
            raise ToolError(f"Falha no {purpose} do YouTube.\n\n{combined or 'yt-dlp encerrou sem informar o erro.'}")
        provider = self._pot_provider_home()
        provider_text = f"PO Token Provider detectado em: {provider}" if provider else "PO Token Provider não encontrado. Execute .\\desktop\\setup.ps1."
        runtime = self._js_runtime_args()
        runtime_text = f"JS runtime ativo: {runtime[-1]}" if runtime else "Nenhum JS runtime compatível detectado (Deno >=2.3 ou Node >=22 recomendado pelo yt-dlp)."
        cookie_text = "Se o vídeo exigir login, configure OPUS_COPY_YOUTUBE_COOKIES_FILE apontando para um cookies.txt exportado do navegador." if not cookie_file else "O arquivo de cookies configurado também não pôde ser usado."
        raise ToolError("Não foi possível concluir o " + purpose + " pelo YouTube.\n\n" + "\n".join(errors) + f"\n\n{provider_text}\n{runtime_text}\n{cookie_text}")

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
                args.extend(["--cookies", browser_arg[5:]] if browser_arg.startswith("file:") else ["--cookies-from-browser", browser_arg])
            args.append(clean_url)
            return args

        def check() -> Path | None:
            paths = [p for p in output_dir.glob("analysis_audio.*") if p.is_file() and p.stat().st_size > 0]
            return max(paths, key=lambda p: p.stat().st_mtime) if paths else None
        return self._run_with_browser_fallbacks(build, output_dir, check, "download do áudio")

    def download_section(self, url: str, output_dir: Path, index: int, clip) -> Path:
        """Download a uniquely cached section; never reuse section_01 from another run."""
        clean_url = url.strip()
        output_dir.mkdir(parents=True, exist_ok=True)
        start = max(0.0, float(clip.start))
        end = max(start + 0.1, float(clip.end))
        cache_key = hashlib.sha256(f"{clean_url}|{start:.3f}|{end:.3f}".encode()).hexdigest()[:16]
        stem = f"section_{index:02d}_{cache_key}"
        existing = sorted(p for p in output_dir.glob(stem + ".*") if p.is_file() and p.stat().st_size > 0)
        if existing:
            return existing[0]
        pattern = str(output_dir / f"{stem}.%(ext)s")

        def build(browser_arg: str | None) -> list[str]:
            args = self._base_args() + ["--download-sections", f"*{start:.3f}-{end:.3f}", "--merge-output-format", "mp4", "-o", pattern]
            if browser_arg:
                args.extend(["--cookies", browser_arg[5:]] if browser_arg.startswith("file:") else ["--cookies-from-browser", browser_arg])
            args.append(clean_url)
            return args

        def check() -> Path | None:
            candidates = [p for p in output_dir.glob(stem + ".*") if p.is_file() and p.suffix.lower() in {".mp4", ".mkv", ".webm", ".mov"} and p.stat().st_size > 0]
            return max(candidates, key=lambda p: p.stat().st_mtime) if candidates else None
        return self._run_with_browser_fallbacks(build, output_dir, check, f"download do trecho {index}")

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
                args.extend(["--cookies", browser_arg[5:]] if browser_arg.startswith("file:") else ["--cookies-from-browser", browser_arg])
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
