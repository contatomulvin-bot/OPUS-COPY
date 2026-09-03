from __future__ import annotations

from pathlib import Path
from statistics import median

from .tools import ToolError


def _clamp(value: int, low: int, high: int) -> int:
    return max(low, min(high, value))


def find_subject_crop_x(source: Path, sample_seconds: float = 1.0) -> tuple[int, int, str]:
    """Find a stable 9:16 crop around the most prominent detected face.

    Returns crop_x, crop_width and a mode label. If face detection is not
    possible, the caller can safely use the center crop.
    """
    try:
        import cv2  # type: ignore
    except ImportError:
        raise ToolError("OpenCV não está instalado para o enquadramento automático.")

    cap = cv2.VideoCapture(str(source))
    if not cap.isOpened():
        raise ToolError(f"Não foi possível abrir o vídeo para enquadramento: {source}")

    try:
        width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH) or 0)
        height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT) or 0)
        fps = float(cap.get(cv2.CAP_PROP_FPS) or 0)
        frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
        duration = frames / fps if fps > 0 else 0
        if width <= 0 or height <= 0:
            return 0, 0, "center"
        crop_width = min(width, max(1, int(round(height * 9 / 16))))
        if width <= crop_width:
            return 0, crop_width, "full"

        cascade = cv2.CascadeClassifier(str(Path(cv2.data.haarcascades) / "haarcascade_frontalface_default.xml"))
        if cascade.empty():
            return (width - crop_width) // 2, crop_width, "center"

        centers: list[int] = []
        step = max(0.5, float(sample_seconds))
        sample_times = [0.0]
        if duration > 2:
            t = step
            while t < duration - 0.5 and len(sample_times) < 30:
                sample_times.append(t)
                t += step
            sample_times.append(max(0.0, duration - 0.5))

        for timestamp in sample_times:
            cap.set(cv2.CAP_PROP_POS_MSEC, timestamp * 1000)
            ok, frame = cap.read()
            if not ok or frame is None:
                continue
            scale = min(1.0, 640.0 / max(frame.shape[1], 1))
            small = cv2.resize(frame, None, fx=scale, fy=scale) if scale < 1 else frame
            gray = cv2.cvtColor(small, cv2.COLOR_BGR2GRAY)
            faces = cascade.detectMultiScale(gray, scaleFactor=1.1, minNeighbors=5, minSize=(35, 35))
            if len(faces) == 0:
                continue
            x, y, w, h = max(faces, key=lambda item: item[2] * item[3])
            center_small = x + w / 2
            centers.append(int(round(center_small / scale)))

        if not centers:
            return (width - crop_width) // 2, crop_width, "center"

        # Median avoids a single false detection causing a large jump.
        subject_center = int(round(median(centers)))
        crop_x = _clamp(subject_center - crop_width // 2, 0, width - crop_width)
        return crop_x, crop_width, "face"
    finally:
        cap.release()
