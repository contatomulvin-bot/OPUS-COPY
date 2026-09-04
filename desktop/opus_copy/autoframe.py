from __future__ import annotations

import math
import os
from dataclasses import dataclass
from pathlib import Path
from statistics import median
from typing import Iterable, Sequence

from .tools import ToolError


REFRAME_VERSION = "face-track-v1"


def _clamp(value: float, low: float, high: float) -> float:
    return max(low, min(high, value))


@dataclass(frozen=True)
class CropKeyframe:
    time: float
    x: int


@dataclass(frozen=True)
class ReframePlan:
    """A time-varying horizontal crop plan consumed directly by FFmpeg."""

    frame_width: int
    crop_width: int
    keyframes: tuple[CropKeyframe, ...]
    mode: str
    detected_samples: int = 0
    total_samples: int = 0

    def ffmpeg_crop_filter(self) -> str:
        if self.crop_width <= 0:
            return "crop=ih*9/16:ih:(iw-ih*9/16)/2:0"
        expression = _crop_x_expression(self.keyframes)
        # Commas belong to FFmpeg's expression language, not to the filter chain.
        expression = expression.replace(",", r"\,")
        return f"crop={self.crop_width}:ih:{expression}:0"


def _crop_x_expression(keyframes: Sequence[CropKeyframe]) -> str:
    if not keyframes:
        return "(iw-ow)/2"
    if len(keyframes) == 1:
        return str(int(keyframes[0].x))

    expression = str(int(keyframes[-1].x))
    for left, right in reversed(list(zip(keyframes, keyframes[1:]))):
        elapsed = max(0.001, right.time - left.time)
        delta = right.x - left.x
        if delta == 0:
            segment = str(int(left.x))
        else:
            segment = f"{left.x}+({delta})*(t-{left.time:.3f})/{elapsed:.3f}"
        expression = f"if(lt(t,{right.time:.3f}),{segment},{expression})"
    return expression


def _sample_times(duration: float, interval: float, max_samples: int) -> list[float]:
    duration = max(0.0, duration)
    if duration <= 0.05:
        return [0.0]
    interval = max(0.20, interval)
    count = min(max(2, int(math.ceil(duration / interval)) + 1), max(2, max_samples))
    last = max(0.0, duration - min(0.05, duration / 2))
    return [last * index / (count - 1) for index in range(count)]


def _iou(a: Sequence[int], b: Sequence[int]) -> float:
    ax, ay, aw, ah = a
    bx, by, bw, bh = b
    left, top = max(ax, bx), max(ay, by)
    right, bottom = min(ax + aw, bx + bw), min(ay + ah, by + bh)
    intersection = max(0, right - left) * max(0, bottom - top)
    union = aw * ah + bw * bh - intersection
    return intersection / union if union > 0 else 0.0


def _deduplicate_faces(faces: Iterable[Sequence[int]]) -> list[tuple[int, int, int, int]]:
    ordered = sorted((tuple(int(v) for v in face[:4]) for face in faces), key=lambda face: face[2] * face[3], reverse=True)
    kept: list[tuple[int, int, int, int]] = []
    for face in ordered:
        if not any(_iou(face, other) >= 0.35 for other in kept):
            kept.append(face)
    return kept


def _choose_tracked_face(
    faces: Sequence[Sequence[int]], previous_center: float | None, frame_width: int
) -> tuple[int, int, int, int] | None:
    if not faces:
        return None

    normalized = [tuple(int(value) for value in face[:4]) for face in faces]
    if previous_center is None:
        # Prefer a large face, with a small center bias to avoid edge false positives.
        return max(
            normalized,
            key=lambda face: face[2]
            * face[3]
            * (1.0 - 0.18 * abs((face[0] + face[2] / 2) - frame_width / 2) / max(frame_width / 2, 1)),
        )

    largest_area = max(face[2] * face[3] for face in normalized)
    return max(
        normalized,
        key=lambda face: (
            0.72 * (1.0 - min(1.0, abs((face[0] + face[2] / 2) - previous_center) / max(frame_width * 0.45, 1)))
            + 0.28 * ((face[2] * face[3]) / max(largest_area, 1))
        ),
    )


def _fill_missing_positions(
    times: Sequence[float], positions: Sequence[float | None], fallback: float
) -> list[float]:
    known = [index for index, value in enumerate(positions) if value is not None]
    if not known:
        return [fallback for _ in times]

    filled = [fallback if value is None else float(value) for value in positions]
    first, last = known[0], known[-1]
    for index in range(first):
        filled[index] = filled[first]
    for index in range(last + 1, len(filled)):
        filled[index] = filled[last]

    for left_index, right_index in zip(known, known[1:]):
        left_value, right_value = filled[left_index], filled[right_index]
        span = max(0.001, times[right_index] - times[left_index])
        for index in range(left_index + 1, right_index):
            ratio = (times[index] - times[left_index]) / span
            filled[index] = left_value + (right_value - left_value) * ratio
    return filled


def _smooth_crop_positions(
    times: Sequence[float], centers: Sequence[float], frame_width: int, crop_width: int
) -> list[CropKeyframe]:
    if not times:
        return [CropKeyframe(0.0, max(0, (frame_width - crop_width) // 2))]

    max_x = max(0, frame_width - crop_width)
    raw_x = [_clamp(center - crop_width / 2, 0, max_x) for center in centers]
    # A rolling median rejects isolated false detections without delaying a real pan much.
    filtered: list[float] = []
    for index in range(len(raw_x)):
        start, end = max(0, index - 2), min(len(raw_x), index + 3)
        filtered.append(float(median(raw_x[start:end])))

    smoothed = [filtered[0]]
    time_constant = 0.42
    max_speed = max(90.0, crop_width * 0.85)
    dead_zone = max(3.0, crop_width * 0.012)
    for index in range(1, len(filtered)):
        dt = max(0.001, times[index] - times[index - 1])
        previous = smoothed[-1]
        target = filtered[index]
        if abs(target - previous) <= dead_zone:
            smoothed.append(previous)
            continue
        alpha = 1.0 - math.exp(-dt / time_constant)
        requested = (target - previous) * alpha
        movement = _clamp(requested, -max_speed * dt, max_speed * dt)
        smoothed.append(_clamp(previous + movement, 0, max_x))

    points = [CropKeyframe(round(float(t), 3), int(round(x))) for t, x in zip(times, smoothed)]
    return _simplify_keyframes(points)


def _perpendicular_distance(point: CropKeyframe, start: CropKeyframe, end: CropKeyframe) -> float:
    elapsed = end.time - start.time
    if abs(elapsed) < 1e-9:
        return abs(point.x - start.x)
    ratio = (point.time - start.time) / elapsed
    expected_x = start.x + (end.x - start.x) * ratio
    return abs(point.x - expected_x)


def _rdp(points: Sequence[CropKeyframe], epsilon: float) -> list[CropKeyframe]:
    if len(points) <= 2:
        return list(points)
    distance, split = 0.0, 0
    for index in range(1, len(points) - 1):
        candidate = _perpendicular_distance(points[index], points[0], points[-1])
        if candidate > distance:
            distance, split = candidate, index
    if distance <= epsilon:
        return [points[0], points[-1]]
    left = _rdp(points[: split + 1], epsilon)
    right = _rdp(points[split:], epsilon)
    return left[:-1] + right


def _simplify_keyframes(points: Sequence[CropKeyframe], max_points: int = 28) -> list[CropKeyframe]:
    if len(points) <= 2:
        return list(points)
    epsilon = 3.0
    simplified = _rdp(points, epsilon)
    while len(simplified) > max_points and epsilon < 96:
        epsilon *= 1.5
        simplified = _rdp(points, epsilon)
    if len(simplified) > max_points:
        indexes = sorted({round(index * (len(simplified) - 1) / (max_points - 1)) for index in range(max_points)})
        simplified = [simplified[index] for index in indexes]
    return simplified


def _detect_faces(cv2, gray, cascades) -> list[tuple[int, int, int, int]]:
    min_side = max(28, int(min(gray.shape[:2]) * 0.075))
    detections: list[tuple[int, int, int, int]] = []
    frontal, profile = cascades
    detections.extend(frontal.detectMultiScale(gray, scaleFactor=1.08, minNeighbors=5, minSize=(min_side, min_side)))
    detections.extend(profile.detectMultiScale(gray, scaleFactor=1.08, minNeighbors=4, minSize=(min_side, min_side)))

    flipped = cv2.flip(gray, 1)
    for x, y, width, height in profile.detectMultiScale(
        flipped, scaleFactor=1.08, minNeighbors=4, minSize=(min_side, min_side)
    ):
        detections.append((gray.shape[1] - int(x) - int(width), int(y), int(width), int(height)))
    return _deduplicate_faces(detections)


def build_reframe_plan(
    source: Path,
    sample_seconds: float | None = None,
    start_seconds: float = 0.0,
    duration: float | None = None,
) -> ReframePlan:
    """Detect and track a face, then build a smooth dynamic 9:16 crop path."""
    try:
        import cv2  # type: ignore
    except ImportError as exc:
        raise ToolError("OpenCV não está instalado para o enquadramento automático.") from exc

    cap = cv2.VideoCapture(str(source))
    if not cap.isOpened():
        raise ToolError(f"Não foi possível abrir o vídeo para enquadramento: {source}")

    try:
        width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH) or 0)
        height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT) or 0)
        fps = float(cap.get(cv2.CAP_PROP_FPS) or 0)
        frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
        source_duration = frames / fps if fps > 0 else 0.0
        if width <= 0 or height <= 0:
            return ReframePlan(width, 0, (), "center")

        crop_width = min(width, max(1, int(round(height * 9 / 16))))
        center_x = max(0, (width - crop_width) // 2)
        if width <= crop_width:
            return ReframePlan(width, crop_width, (CropKeyframe(0.0, 0),), "full")

        cascade_root = Path(cv2.data.haarcascades)
        frontal = cv2.CascadeClassifier(str(cascade_root / "haarcascade_frontalface_default.xml"))
        profile = cv2.CascadeClassifier(str(cascade_root / "haarcascade_profileface.xml"))
        if frontal.empty() or profile.empty():
            return ReframePlan(width, crop_width, (CropKeyframe(0.0, center_x),), "center")

        start_seconds = max(0.0, float(start_seconds))
        available = max(0.0, source_duration - start_seconds) if source_duration > 0 else 0.0
        window_duration = available if duration is None else max(0.0, min(float(duration), available or float(duration)))
        interval = sample_seconds
        if interval is None:
            try:
                interval = float(os.getenv("OPUS_COPY_FACE_SAMPLE_SECONDS", "0.40"))
            except ValueError:
                interval = 0.40
        try:
            max_samples = int(os.getenv("OPUS_COPY_FACE_MAX_SAMPLES", "120"))
        except ValueError:
            max_samples = 120
        times = _sample_times(window_duration, interval, max(12, min(max_samples, 240)))

        positions: list[float | None] = []
        previous_center: float | None = None
        missed_samples = 0
        detected_samples = 0
        for local_time in times:
            cap.set(cv2.CAP_PROP_POS_MSEC, (start_seconds + local_time) * 1000)
            ok, frame = cap.read()
            if not ok or frame is None:
                positions.append(None)
                missed_samples += 1
                continue

            scale = min(1.0, 640.0 / max(frame.shape[1], 1))
            small = cv2.resize(frame, None, fx=scale, fy=scale) if scale < 1 else frame
            gray = cv2.cvtColor(small, cv2.COLOR_BGR2GRAY)
            faces = _detect_faces(cv2, gray, (frontal, profile))
            tracked = _choose_tracked_face(
                faces,
                previous_center * scale if previous_center is not None else None,
                small.shape[1],
            )
            if tracked is None:
                positions.append(None)
                missed_samples += 1
                if missed_samples >= 4:
                    previous_center = None
                continue

            x, _y, face_width, _face_height = tracked
            previous_center = (x + face_width / 2) / scale
            positions.append(previous_center)
            missed_samples = 0
            detected_samples += 1

        if detected_samples == 0:
            return ReframePlan(width, crop_width, (CropKeyframe(0.0, center_x),), "center", 0, len(times))

        centers = _fill_missing_positions(times, positions, width / 2)
        keyframes = tuple(_smooth_crop_positions(times, centers, width, crop_width))
        movement = max(keyframe.x for keyframe in keyframes) - min(keyframe.x for keyframe in keyframes)
        mode = "face-track" if movement > max(4, crop_width * 0.02) else "face-static"
        return ReframePlan(width, crop_width, keyframes, mode, detected_samples, len(times))
    finally:
        cap.release()


def find_subject_crop_x(source: Path, sample_seconds: float = 1.0) -> tuple[int, int, str]:
    """Backward-compatible static crop API used by older integrations."""
    plan = build_reframe_plan(source, sample_seconds=sample_seconds)
    crop_x = int(round(median(keyframe.x for keyframe in plan.keyframes))) if plan.keyframes else 0
    return crop_x, plan.crop_width, plan.mode
