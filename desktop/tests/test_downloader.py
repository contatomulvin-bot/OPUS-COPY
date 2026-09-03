import os
import subprocess
import unittest
from unittest.mock import patch

from opus_copy.downloader import YouTubeDownloader


class DownloaderRuntimeTests(unittest.TestCase):
    def test_base_args_isolate_yt_dlp_from_external_plugins(self):
        downloader = YouTubeDownloader.__new__(YouTubeDownloader)
        downloader.executable = "yt-dlp"
        with patch.object(downloader, "_js_runtime_args", return_value=[]):
            args = downloader._base_args()

        self.assertIn("--ignore-config", args)
        self.assertIn("--no-plugin-dirs", args)
        self.assertNotIn("youtubepot-bgutilscript", " ".join(args))

    def test_node_replaces_default_deno_runtime(self):
        def which(name):
            return {"node": "C:/Program Files/nodejs/node.exe", "deno": "C:/WinGet/deno.exe"}.get(name)

        node_version = subprocess.CompletedProcess([], 0, stdout="v22.18.0\n", stderr="")
        with (
            patch.dict(os.environ, {}, clear=True),
            patch("opus_copy.downloader.shutil.which", side_effect=which),
            patch("opus_copy.downloader.run_process", return_value=node_version),
        ):
            args = YouTubeDownloader._js_runtime_args()

        self.assertEqual(
            args,
            ["--no-js-runtimes", "--js-runtimes", "node:C:/Program Files/nodejs/node.exe"],
        )
        self.assertNotIn("deno:C:/WinGet/deno.exe", args)

    def test_explicit_runtime_also_clears_yt_dlp_defaults(self):
        with patch.dict(os.environ, {"OPUS_COPY_YOUTUBE_JS_RUNTIME": "node:C:/node.exe"}, clear=True):
            self.assertEqual(
                YouTubeDownloader._js_runtime_args(),
                ["--no-js-runtimes", "--js-runtimes", "node:C:/node.exe"],
            )


if __name__ == "__main__":
    unittest.main()
