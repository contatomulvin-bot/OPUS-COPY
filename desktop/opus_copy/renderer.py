from __future__ import annotations

from pathlib import Path

from .analyzer import ClipCandidate
from .tools import ToolError, require_executable, run_process


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
    for segment in transcript.get("segments", []):
        start = float(segment.get("start", 0))
        end = float(segment.get("end", 0))
        if end <= clip.start or start >= clip.end:
            continue
        words = segment.get("words") or []
        if words:
            group: list[str] = []
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
                    group, group_start, group_end = [], None, None
            if group and group_start is not None and group_end is not None:
                entries.append((group_start - clip.start, group_end - clip.start, " ".join(group)))
        else:
            text = str(segment.get("text", "")).strip()
            if text:
                entries.append((max(start, clip.start) - clip.start, min(end, clip.end) - clip.start, text))

    path.write_text(
        "\n\n".join(
            f"{i}\n{_srt_time(s)} --> {_srt_time(e)}\n{text}"
            for i, (s, e, text) in enumerate(entries, 1)
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

        subtitle_filter = f"subtitles='{_escape_subtitle_path(srt)}'"
        vf = f"crop=ih*9/16:ih:(iw-ih*9/16)/2:0,scale=1080:1920:flags=fast_bilinear,{subtitle_filter}"
        duration = max(0.1, clip.end - clip.start)
        is_pretrimmed_section = source.name.lower().startswith("section_")

        args = [self.ffmpeg, "-y"]
        if not is_pretrimmed_section:
            args.extend(["-ss", f"{clip.start:.3f}"])
        args.extend(["-i", str(source), "-t", f"{duration:.3f}", "-vf", vf])
        args.extend([
            "-c:v", "libx264",
            "-preset", "veryfast",
            "-crf", "21",
            "-c:a", "aac",
            "-b:a", "128k",
            "-movflags", "+faststart",
            str(output),
        ])
        result = run_process(args, timeout=max(600, int(duration * 15)))
        if result.returncode != 0:
            raise ToolError(f"FFmpeg falhou ao renderizar o clip:\n{result.stderr.strip()}")
        if not output.exists() or output.stat().st_size == 0:
            raise ToolError("FFmpeg terminou sem criar o clip final.")
        return output
