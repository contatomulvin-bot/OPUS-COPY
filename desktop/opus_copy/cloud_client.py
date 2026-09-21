from __future__ import annotations

import ctypes
import json
import os
import platform
import socket
import uuid
from ctypes import wintypes
from pathlib import Path
from typing import Any
from urllib import error, parse, request


class CloudError(RuntimeError):
    def __init__(self, code: str, message: str, status: int = 0) -> None:
        super().__init__(message)
        self.code = code
        self.status = status


class _DataBlob(ctypes.Structure):
    _fields_ = [
        ("cbData", wintypes.DWORD),
        ("pbData", ctypes.POINTER(ctypes.c_char)),
    ]


class MistcutCloudClient:
    def __init__(self, base_url: str, timeout: float = 12.0) -> None:
        self.base_url = base_url.rstrip("/")
        self.timeout = timeout
        self.access_token: str | None = None
        self.profile: dict[str, Any] | None = None
        self.credits: dict[str, Any] = {"balance": 0, "reserved": 0}
        appdata = os.getenv("APPDATA", "").strip()
        self.data_dir = Path(appdata) / "MISTCUT" if appdata else Path.home() / ".mistcut"
        self.data_dir.mkdir(parents=True, exist_ok=True)
        self.device_key = self._load_or_create_device_key()
        self.device_name = socket.gethostname() or "Windows PC"

    @classmethod
    def from_env(cls) -> "MistcutCloudClient":
        return cls(os.getenv("MISTCUT_CLOUD_API_URL", "https://api.mistcut.com"))

    def _load_or_create_device_key(self) -> str:
        path = self.data_dir / "device.json"
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
            value = str(payload.get("deviceKey", "")).strip()
            if len(value) >= 8:
                return value
        except Exception:
            pass
        value = str(uuid.uuid4())
        path.write_text(json.dumps({"deviceKey": value}), encoding="utf-8")
        return value

    @staticmethod
    def _protect_windows(data: bytes) -> bytes:
        if os.name != "nt":
            raise OSError("DPAPI is only available on Windows")
        buffer = ctypes.create_string_buffer(data)
        in_blob = _DataBlob(len(data), ctypes.cast(buffer, ctypes.POINTER(ctypes.c_char)))
        out_blob = _DataBlob()
        crypt32 = ctypes.windll.crypt32
        kernel32 = ctypes.windll.kernel32
        if not crypt32.CryptProtectData(
            ctypes.byref(in_blob),
            ctypes.c_wchar_p("MISTCUT Session"),
            None,
            None,
            None,
            0,
            ctypes.byref(out_blob),
        ):
            raise ctypes.WinError()
        try:
            return ctypes.string_at(out_blob.pbData, out_blob.cbData)
        finally:
            kernel32.LocalFree(out_blob.pbData)

    @staticmethod
    def _unprotect_windows(data: bytes) -> bytes:
        if os.name != "nt":
            raise OSError("DPAPI is only available on Windows")
        buffer = ctypes.create_string_buffer(data)
        in_blob = _DataBlob(len(data), ctypes.cast(buffer, ctypes.POINTER(ctypes.c_char)))
        out_blob = _DataBlob()
        crypt32 = ctypes.windll.crypt32
        kernel32 = ctypes.windll.kernel32
        if not crypt32.CryptUnprotectData(
            ctypes.byref(in_blob),
            None,
            None,
            None,
            None,
            0,
            ctypes.byref(out_blob),
        ):
            raise ctypes.WinError()
        try:
            return ctypes.string_at(out_blob.pbData, out_blob.cbData)
        finally:
            kernel32.LocalFree(out_blob.pbData)

    @property
    def _session_path(self) -> Path:
        return self.data_dir / "session.bin"

    def _save_refresh_token(self, token: str) -> None:
        if os.name != "nt":
            return
        encrypted = self._protect_windows(token.encode("utf-8"))
        self._session_path.write_bytes(encrypted)

    def _load_refresh_token(self) -> str | None:
        if os.name != "nt" or not self._session_path.is_file():
            return None
        try:
            return self._unprotect_windows(self._session_path.read_bytes()).decode("utf-8")
        except Exception:
            self.clear_local_session()
            return None

    def clear_local_session(self) -> None:
        self.access_token = None
        self.profile = None
        self.credits = {"balance": 0, "reserved": 0}
        try:
            self._session_path.unlink(missing_ok=True)
        except Exception:
            pass

    def _accept_session(self, payload: dict[str, Any]) -> dict[str, Any]:
        access = str(payload.get("accessToken", "")).strip()
        refresh = str(payload.get("refreshToken", "")).strip()
        if not access or not refresh:
            raise CloudError("INVALID_SESSION_RESPONSE", "O servidor retornou uma sessão inválida.")
        self.access_token = access
        self.profile = payload.get("user") if isinstance(payload.get("user"), dict) else None
        if isinstance(payload.get("credits"), dict):
            self.credits = payload["credits"]
        self._save_refresh_token(refresh)
        return payload

    def _request(
        self,
        method: str,
        path: str,
        body: dict[str, Any] | None = None,
        *,
        auth: bool = True,
        retry_refresh: bool = True,
    ) -> dict[str, Any]:
        headers = {
            "Accept": "application/json",
            "User-Agent": "MISTCUT-Desktop/4.7",
            "X-Mistcut-Device-Key": self.device_key,
        }
        data = None
        if body is not None:
            data = json.dumps(body).encode("utf-8")
            headers["Content-Type"] = "application/json"

        if auth:
            if not self.access_token:
                if not self.refresh():
                    raise CloudError("AUTH_REQUIRED", "Entre na sua conta MISTCUT.")
            headers["Authorization"] = "Bearer " + str(self.access_token)

        req = request.Request(
            self.base_url + path,
            data=data,
            headers=headers,
            method=method,
        )

        try:
            with request.urlopen(req, timeout=self.timeout) as response:
                raw = response.read().decode("utf-8")
                return json.loads(raw) if raw else {}
        except error.HTTPError as exc:
            raw = exc.read().decode("utf-8", errors="replace")
            try:
                payload = json.loads(raw)
                details = payload.get("error", {})
                code = str(details.get("code", "HTTP_ERROR"))
                message = str(details.get("message", raw or exc.reason))
            except Exception:
                code = "HTTP_ERROR"
                message = raw or str(exc.reason)

            if auth and exc.code == 401 and retry_refresh and self.refresh():
                return self._request(method, path, body, auth=True, retry_refresh=False)
            raise CloudError(code, message, exc.code) from exc
        except (error.URLError, TimeoutError, OSError) as exc:
            raise CloudError(
                "CLOUD_UNAVAILABLE",
                "Não foi possível conectar ao MISTCUT Cloud. Verifique sua internet.",
            ) from exc

    def login(self, email: str, password: str) -> dict[str, Any]:
        payload = self._request(
            "POST",
            "/v1/auth/login",
            {
                "email": email,
                "password": password,
                "deviceKey": self.device_key,
                "deviceName": self.device_name,
                "platform": "Windows " + platform.release(),
            },
            auth=False,
        )
        return self._accept_session(payload)

    def refresh(self) -> bool:
        refresh_token = self._load_refresh_token()
        if not refresh_token:
            return False
        try:
            payload = self._request(
                "POST",
                "/v1/auth/refresh",
                {"refreshToken": refresh_token},
                auth=False,
                retry_refresh=False,
            )
            self._accept_session(payload)
            return True
        except CloudError as exc:
            if exc.code != "CLOUD_UNAVAILABLE":
                self.clear_local_session()
            return False

    def restore_session(self) -> bool:
        return self.refresh()

    def logout(self) -> None:
        try:
            if self.access_token:
                self._request("POST", "/v1/auth/logout", {}, auth=True)
        except CloudError:
            pass
        finally:
            self.clear_local_session()

    def me(self) -> dict[str, Any]:
        payload = self._request("GET", "/v1/me")
        if isinstance(payload.get("user"), dict):
            self.profile = payload["user"]
        if isinstance(payload.get("credits"), dict):
            self.credits = payload["credits"]
        return payload

    def balance(self) -> dict[str, Any]:
        payload = self._request("GET", "/v1/credits/balance")
        self.credits = {
            "balance": int(payload.get("balance", 0)),
            "reserved": int(payload.get("reserved", 0)),
            "unlimited": bool(payload.get("unlimited", False)),
        }
        return payload

    def quote(self, action_code: str, quantity: int) -> dict[str, Any]:
        query = parse.urlencode({"actionCode": action_code, "quantity": quantity})
        return self._request("GET", "/v1/credits/quote?" + query)

    def analyze_transcript(
        self,
        transcript: dict[str, Any],
        max_clips: int,
        idempotency_key: str,
    ) -> dict[str, Any]:
        raw_segments = transcript.get("segments", [])
        segments = []
        for item in raw_segments:
            try:
                start = float(item.get("start", 0))
                end = float(item.get("end", 0))
                text = str(item.get("text", "")).strip()
            except (TypeError, ValueError, AttributeError):
                continue
            if text and end > start >= 0:
                segments.append({"start": start, "end": end, "text": text})

        if not segments:
            raise CloudError(
                "INVALID_TRANSCRIPT",
                "A transcrição não contém segmentos utilizáveis.",
            )

        payload = self._request(
            "POST",
            "/v1/ai/analyze",
            {
                "segments": segments,
                "maxClips": int(max_clips),
                "idempotencyKey": idempotency_key,
            },
        )
        if isinstance(payload.get("credits"), dict):
            self.credits = payload["credits"]
        return payload

