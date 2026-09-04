from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from .analyzer import ClipCandidate
from .autoframe import build_reframe_plan
from .tools import ToolError, require_executable, run_process


def _srt_time(seconds: float) -> str:
    ms = max(0, int(round(seconds * 1000))); h, ms = divmod(ms, 3_600_000); m, ms = divmod(ms, 60_000); s, ms = divmod(ms, 1000)
    return f"{h:02d}:{m:02d}:{s:02d},{ms:03d}"


def _ass_time(seconds: float) -> str:
    value = max(0, int(round(seconds * 100))); h, value = divmod(value, 360000); m, value = divmod(value, 6000); s, cs = divmod(value, 100)
    return f"{h}:{m:02d}:{s:02d}.{cs:02d}"


def _ass_color(value: str, fallback: str) -> str:
    raw = (value or fallback).strip().lstrip("#")
    if len(raw) != 6:
        raw = fallback.lstrip("#")
    try: int(raw, 16)
    except ValueError: raw = fallback.lstrip("#")
    rr, gg, bb = raw[0:2], raw[2:4], raw[4:6]
    return f"&H00{bb}{gg}{rr}&"


def _ass_escape(text: str) -> str:
    return text.replace("\\", "\\\\").replace("{", "\\{").replace("}", "\\}").replace("\n", "\\N")


def _escape_subtitle_path(path: Path) -> str:
    value = path.resolve().as_posix()
    return value.replace("'", "\\'").replace(":", "\\:")


@dataclass(frozen=True)
class SubtitleStyle:
    font_family: str = "Arial"
    font_size: int = 64
    bold: bool = True
    text_color: str = "#FFFFFF"
    outline_color: str = "#000000"
    background_color: str = "#000000"
    background_opacity: int = 0
    outline_width: int = 4
    shadow: int = 2
    vertical_position: int = 82


def write_ass(transcript: dict, clip: ClipCandidate, path: Path, style: SubtitleStyle) -> None:
    position = max(5, min(95, int(style.vertical_position))); y = int(round(1920 * position / 100)); alignment = 5
    back_alpha = max(0, min(100, int(style.background_opacity))); back_alpha_ass = 255 - round(back_alpha * 2.55)
    back_color = _ass_color(style.background_color, "#000000"); text_color = _ass_color(style.text_color, "#FFFFFF"); outline_color = _ass_color(style.outline_color, "#000000"); bold = -1 if style.bold else 0
    lines = ["[Script Info]", "ScriptType: v4.00+", "PlayResX: 1080", "PlayResY: 1920", "ScaledBorderAndShadow: yes", "", "[V4+ Styles]", "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding", f"Style: Default,{style.font_family},{max(10, int(style.font_size))},{text_color},{text_color},{outline_color},&H{back_alpha_ass:02X}{back_color[4:]},{bold},0,0,0,100,100,0,0,3,{max(0, int(style.outline_width))},{max(0, int(style.shadow))},{alignment},40,40,0,1", "", "[Events]", "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text"]
    for segment in transcript.get("segments", []):
        start = float(segment.get("start", 0)); end = float(segment.get("end", 0))
        if end <= clip.start or start >= clip.end: continue
        words = segment.get("words") or []
        if words:
            group: list[str] = []; group_start = None; group_end = None
            for word in words:
                ws = float(word.get("start", start)); we = float(word.get("end", end))
                if we <= clip.start or ws >= clip.end: continue
                ws = max(ws, clip.start); we = min(we, clip.end)
                if group_start is None: group_start = ws
                group.append(str(word.get("word", "")).strip()); group_end = we
                if len(group) >= 7:
                    lines.append(f"Dialogue: 0,{_ass_time(group_start - clip.start)},{_ass_time(group_end - clip.start)},Default,,0,0,0,,{{\\pos(540,{y})}}{_ass_escape(' '.join(group))}")
                    group, group_start, group_end = [], None, None
            if group and group_start is not None and group_end is not None:
                lines.append(f"Dialogue: 0,{_ass_time(group_start - clip.start)},{_ass_time(group_end - clip.start)},Default,,0,0,0,,{{\\pos(540,{y})}}{_ass_escape(' '.join(group))}")
        else:
            text = str(segment.get("text", "")).strip()
            if text:
                s = max(start, clip.start) - clip.start; e = min(end, clip.end) - clip.start
                if e > s: lines.append(f"Dialogue: 0,{_ass_time(s)},{_ass_time(e)},Default,,0,0,0,,{{\\pos(540,{y})}}{_ass_escape(text)}")
    path.write_text("\n".join(lines) + "\n", encoding="utf-8-sig")


def write_srt(transcript: dict, clip: ClipCandidate, path: Path) -> None:
    entries = []
    for segment in transcript.get("segments", []):
        start = float(segment.get("start", 0)); end = float(segment.get("end", 0))
        if end <= clip.start or start >= clip.end: continue
        text = str(segment.get("text", "")).strip()
        if text: entries.append((max(start, clip.start) - clip.start, min(end, clip.end) - clip.start, text))
    path.write_text("\n\n".join(f"{i}\n{_srt_time(s)} --> {_srt_time(e)}\n{text}" for i, (s, e, text) in enumerate(entries, 1) if e > s and text) + "\n", encoding="utf-8")


class ClipRenderer:
    def __init__(self, subtitle_style: SubtitleStyle | None = None, auto_reframe: bool = True) -> None:
        self.ffmpeg = require_executable("ffmpeg")
        self.subtitle_style = subtitle_style or SubtitleStyle()
        self.auto_reframe = auto_reframe

    def _render(self, source: Path, clip: ClipCandidate, transcript: dict, output: Path, source_offset: float) -> Path:
        if not source.exists() or source.stat().st_size == 0: raise ToolError(f"Arquivo de entrada inválido: {source}")
        output.parent.mkdir(parents=True, exist_ok=True); ass = output.with_suffix(".ass"); write_ass(transcript, clip, ass, self.subtitle_style)
        duration = max(0.1, clip.end - clip.start)
        try:
            plan = build_reframe_plan(
                source,
                start_seconds=source_offset,
                duration=duration,
            ) if self.auto_reframe else None
            vf_crop = plan.ffmpeg_crop_filter() if plan else "crop=ih*9/16:ih:(iw-ih*9/16)/2:0"
        except Exception:
            # A detector failure must not lose the clip: FFmpeg can always center-crop.
            vf_crop = "crop=ih*9/16:ih:(iw-ih*9/16)/2:0"
        subtitle_filter = f"subtitles='{_escape_subtitle_path(ass)}'"
        vf = f"{vf_crop},scale=1080:1920:flags=fast_bilinear,{subtitle_filter}"
        args = [self.ffmpeg, "-y", "-ss", f"{source_offset:.3f}", "-i", str(source), "-t", f"{duration:.3f}", "-vf", vf, "-c:v", "libx264", "-preset", "veryfast", "-crf", "21", "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart", str(output)]
        result = run_process(args, timeout=max(600, int(duration * 15)))
        if result.returncode != 0: raise ToolError(f"FFmpeg falhou ao renderizar o clip:\n{result.stderr.strip()}")
        if not output.exists() or output.stat().st_size == 0: raise ToolError("FFmpeg terminou sem criar o clip final.")
        return output

    def render(self, source: Path, clip: ClipCandidate, transcript: dict, output: Path) -> Path:
        return self._render(source, clip, transcript, output, source_offset=clip.start)

    def render_section(self, source: Path, clip: ClipCandidate, transcript: dict, output: Path) -> Path:
        return self._render(source, clip, transcript, output, source_offset=0.0)
