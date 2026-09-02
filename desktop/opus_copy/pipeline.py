from __future__ import annotations

import hashlib
import json
import os
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

from .analyzer import ViralAnalyzer
from .downloader import YouTubeDownloader
from .renderer import ClipRenderer, SubtitleStyle
from .tools import ToolError, free_space_gb
from .transcriber import WhisperXTranscriber, save_transcript


class Pipeline:
    def __init__(self, workspace: Path) -> None:
        self.workspace = workspace

    @staticmethod
    def _load_cached_transcript(path: Path) -> dict | None:
        if not path.is_file() or path.stat().st_size == 0:
            return None
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
            return data if data.get("segments") else None
        except (OSError, ValueError, TypeError):
            return None

    @staticmethod
    def _clip_cache_key(url: str, clip, language: str) -> str:
        raw = f"{url.strip()}|{language}|{float(clip.start):.3f}|{float(clip.end):.3f}"
        return hashlib.sha256(raw.encode("utf-8")).hexdigest()[:16]

    def run(
        self,
        url: str,
        max_clips: int = 5,
        progress=None,
        output_dir: Path | None = None,
        subtitle_style: SubtitleStyle | None = None,
        language: str = "pt",
    ) -> list[Path]:
        self.workspace.mkdir(parents=True, exist_ok=True)
        if free_space_gb(self.workspace) < 2:
            raise ToolError("Pouco espaço livre. Libere pelo menos 2 GB antes de processar um vídeo.")

        language = (language or "pt").strip().lower()
        if language not in {"pt", "en", "es", "fr", "de", "it", "ja", "ko", "zh", "ru"}:
            raise ToolError(f"Idioma de transcrição não suportado: {language}")

        def report(message: str, percent: int | None = None) -> None:
            if progress:
                try:
                    progress(message, percent)
                except TypeError:
                    progress(message)

        downloader = YouTubeDownloader()
        analysis_dir = self.workspace / "analysis"
        analysis_dir.mkdir(parents=True, exist_ok=True)
        transcript_path = analysis_dir / f"transcript_{language}.json"

        report("Baixando somente o áudio para análise…", 3)
        audio = downloader.download_audio(url, analysis_dir, analysis_dir / "analysis_audio.%(ext)s")
        report("Áudio pronto. Verificando transcrição em cache…", 15)

        transcript = self._load_cached_transcript(transcript_path)
        if transcript is None:
            report("Transcrevendo com WhisperX local…", 17)
            transcript = WhisperXTranscriber().transcribe(audio, language=language)
            save_transcript(transcript, transcript_path)
            report("Transcrição concluída.", 50)
        else:
            report(f"Transcrição em cache reutilizada ({language.upper()}).", 50)

        report("A IA está avaliando os melhores momentos…", 52)
        clips = ViralAnalyzer().rank(transcript, max_clips=max_clips)
        if not clips:
            raise ToolError("A IA não encontrou clips válidos na transcrição.")
        report("Momentos encontrados: " + ", ".join(f"{c.score:.0f}/100" for c in clips), 60)

        report("Baixando somente os trechos selecionados…", 61)
        sections_dir = self.workspace / "selected_clips"
        sections_dir.mkdir(parents=True, exist_ok=True)
        download_workers = max(1, min(int(os.getenv("OPUS_COPY_DOWNLOAD_WORKERS", "2")), len(clips)))
        section_paths: list[tuple[int, object, Path]] = []
        with ThreadPoolExecutor(max_workers=download_workers, thread_name_prefix="opus-download") as executor:
            futures = {
                executor.submit(downloader.download_section, url, sections_dir, index, clip): (index, clip)
                for index, clip in enumerate(clips, 1)
            }
            completed = 0
            for future in as_completed(futures):
                index, clip = futures[future]
                section_paths.append((index, clip, future.result()))
                completed += 1
                percent = 60 + round(completed / len(clips) * 20)
                report(f"Trecho {completed}/{len(clips)} baixado.", percent)

        section_paths.sort(key=lambda item: item[0])
        report("Renderizando clips verticais 9:16 com legendas personalizadas…", 81)
        final_dir = Path(output_dir) if output_dir else self.workspace / "clips"
        final_dir.mkdir(parents=True, exist_ok=True)
        renderer = ClipRenderer(subtitle_style=subtitle_style)
        outputs: list[Path] = [Path() for _ in clips]
        render_workers = max(1, min(int(os.getenv("OPUS_COPY_RENDER_WORKERS", "2")), len(clips)))
        style = subtitle_style or SubtitleStyle()
        style_key = hashlib.sha256(repr(style).encode("utf-8")).hexdigest()[:8]

        def render_one(index: int, clip, source: Path) -> tuple[int, Path]:
            key = self._clip_cache_key(url, clip, language)
            output = final_dir / f"clip_{index:02d}_{clip.score:.0f}_{key}_{style_key}.mp4"
            if output.is_file() and output.stat().st_size > 0:
                return index, output
            return index, renderer.render_section(source, clip, transcript, output)

        with ThreadPoolExecutor(max_workers=render_workers, thread_name_prefix="opus-render") as executor:
            futures = [executor.submit(render_one, index, clip, source) for index, clip, source in section_paths]
            completed = 0
            for future in as_completed(futures):
                index, output = future.result()
                outputs[index - 1] = output
                completed += 1
                percent = 80 + round(completed / len(clips) * 20)
                report(f"Clip {completed}/{len(clips)} pronto: {output.name}", percent)

        report(f"Concluído · {len(outputs)} clip(s) gerado(s).", 100)
        return outputs
