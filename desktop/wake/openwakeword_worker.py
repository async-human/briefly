"""
Local wake-word worker process for Briefly desktop.

Protocol:
- Prints a single line `WAKE` to stdout whenever wake phrase is detected.
- Parent process (Tauri) reads stdout and emits `wake-detected`.

Expected runtime:
- BRIEFLY_WAKEWORD_EXE=python
- BRIEFLY_WAKEWORD_ARGS="desktop/wake/openwakeword_worker.py"
"""

from __future__ import annotations

import sys
import time


def main() -> int:
    try:
        from openwakeword.model import Model  # type: ignore
        import pyaudio  # type: ignore
    except Exception:
        # Missing deps: keep process alive briefly so parent can fall back gracefully.
        time.sleep(1.0)
        return 1

    model = Model(wakeword_models=[])
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

