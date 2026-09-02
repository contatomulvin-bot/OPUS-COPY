from __future__ import annotations

import re
from pathlib import Path

from .analyzer import ClipCandidate
from .tools import ToolError, ensure_parent, require_executable, run_process


def _srt_time(seconds: float) -> str:
    ms = max(0, int(round(seconds * 1000)))
    h, ms = divmod(ms, 3_600_000)
    m, ms = divmod(ms, 60_000)
    s, ms = divmod(ms, 1000)
    return f"{h:02d}:{m:02d}:{s:02d},{ms:03d}"


def _escape_subtitle_path(path: Path) -> str:
    value = path.resolve().as_posix()
    return value.replace("'", "\\'").replace(":", "\\:")


def write_srt(transcript: dict, clip: ClipCandidate, path: Path) -> None:
    entries = []
    index = 1
    for segment in transcript.get("segments", []):
        start = float(segment.get("start", 0))
        end = float(segment.get("end", 0))
        if end <= clip.start or start >= clip.end:
            continue
        words = segment.get("words") or []
        if words:
            # Group up to ~7 words so captions remain readable on vertical video.
            group = []
            group_start = None
            group_end = None
            for word in words:
                ws, we = float(word.get("start", start)), float(word.get("end", end))
                if we <= clip.start or ws >= clip.end:
                    continue
                ws = max(ws, clip.start)
                we = min(we, clip.end)
                if group_start is None:
                    group_start = ws
                group.append(str(word.get("word", "")).strip())
                group_end = we
                if len(group) >= 7:
                    entries.append((group_start - clip.start, group_end - clip.start, " ".join(group)))
                    index += 1
                    group, group_start, group_end = [], None, None
            if group and group_start is not None and group_end is not None:
                entries.append((group_start - clip.start, group_end - clip.start, " ".join(group)))
        else:
            entries.append((max(start, clip.start) - clip.start, min(end, clip.end) - clip.start, segment.get("text", "").strip()))

    path.write_text(
        "\n\n".join(
            f"{i}\n{_srt_time(s)} --> {_srt_time(e)}\n{text}"
            for i, (s, e, text) in enumerate(entries, 1) if text
        ) + "\n",
        encoding="utf-8",
    )


class ClipRenderer:
    def __init__(self) -> None:
        self.ffmpeg = require_executable("ffmpeg")

    def render(self, source: Path, clip: ClipCandidate, transcript: dict, output: Path) -> Path:
        output.parent.mkdir(parents=True, exist_ok=True)
        srt = output.with_suffix(".srt")
        write_srt(transcript, clip, srt)

        # Center crop to 9:16, scale to 1080x1920, then burn readable captions.
        subtitle_filter = f"subtitles='{_escape_subtitle_path(srt)}'"
        vf = f"crop=ih*9/16:ih:(iw-ih*9/16)/2:0,scale=1080:1920:flags=lanczos,{subtitle_filter}"
        duration = clip.end - clip.start
        args = [
            self.ffmpeg, "-y",
            "-ss", f"{clip.start:.3f}",
            "-i", str(source),
            "-t", f"{duration:.3f}",
            "-vf", vf,
            "-c:v", "libx264",
            "-preset", "medium",
            "-crf", "20",
            "-c:a", "aac",
            "-b:a", "160k",
            "-movflags", "+faststart",
            str(output),
        ]
        result = run_process(args, timeout=max(600, int(duration * 20)))
        if result.returncode != 0:
            raise ToolError(f"FFmpeg falhou ao renderizar o clip:\n{result.stderr.strip()}")
        if not output.exists() or output.stat().st_size == 0:
            raise ToolError("FFmpeg terminou sem criar o clip final.")
        return output
