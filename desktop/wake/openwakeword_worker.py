"""
Local wake-word worker process for Briefly desktop.

Protocol:
- Prints a single line `WAKE` to stdout whenever wake phrase is detected.
- Parent process (Tauri) reads stdout and emits `wake-detected`.

Expected runtime:
- BRIEFLY_WAKEWORD_EXE=python
- BRIEFLY_WAKEWORD_ARGS="desktop/wake/openwakeword_worker.py"
- BRIEFLY_WAKEWORD_MODEL=path/to/hey_briefly.onnx
"""

from __future__ import annotations

import os
import sys
import time


def main() -> int:
    model_path = os.environ.get("BRIEFLY_WAKEWORD_MODEL", "").strip()
    if not model_path:
        return 1

    try:
        from openwakeword.model import Model  # type: ignore
        import pyaudio  # type: ignore
    except Exception:
        return 1

    try:
        model = Model(wakeword_models=[model_path])
    except Exception:
        return 1

    pa = pyaudio.PyAudio()
    stream = pa.open(
        format=pyaudio.paInt16,
        channels=1,
        rate=16_000,
        input=True,
        frames_per_buffer=1280,
    )
    try:
        while True:
            pcm = stream.read(1280, exception_on_overflow=False)
            scores = model.predict(pcm)
            top_score = 0.0
            for value in scores.values():
                try:
                    top_score = max(top_score, float(value))
                except Exception:
                    pass
            if top_score >= 0.5:
                print("WAKE", flush=True)
                time.sleep(1.5)
    except KeyboardInterrupt:
        return 0
    finally:
        stream.stop_stream()
        stream.close()
        pa.terminate()


if __name__ == "__main__":
    raise SystemExit(main())
