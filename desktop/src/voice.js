"use strict";

/** Split spoken answer into sentence-sized TTS chunks (mirrors mobile orb). */
function splitSentences(text) {
  const raw = text.match(/[^.!?]+[.!?]+["')\]]*\s*|[^.!?]+$/g) || [text];
  const out = [];
  for (const piece of raw) {
    const t = piece.trim();
    if (!t) continue;
    if (out.length && t.length < 18) out[out.length - 1] = `${out[out.length - 1]} ${t}`;
    else out.push(t);
  }
  return out.length ? out : [String(text || "").trim()];
}

/**
 * Play a single audio blob; resolves when playback ends or errors.
 * @param {object} opts
 */
async function playBlobAudio(blob, opts = {}) {
  const { signal, onAudio, onStart } = opts;
  if (!blob || blob.size < 64) {
    throw new Error("Empty audio");
  }
  const url = URL.createObjectURL(blob);
  let started = false;
  try {
    await new Promise((resolve, reject) => {
      const audio = new Audio(url);
      audio.preload = "auto";
      if (onAudio) onAudio(audio);

      const finish = (err) => {
        if (onAudio) onAudio(null);
        URL.revokeObjectURL(url);
        if (err) reject(err);
        else resolve();
      };

      if (signal) {
        signal.addEventListener(
          "abort",
          () => {
            try {
              audio.pause();
              audio.currentTime = 0;
            } catch (_) {}
            finish();
          },
          { once: true },
        );
      }

      audio.onended = () => finish();
      audio.onerror = () => finish(new Error("Audio playback error"));

      const tryPlay = () => {
        audio
          .play()
          .then(() => {
            if (!started) {
              started = true;
              if (onStart) onStart();
            }
          })
          .catch((err) => finish(err));
      };

      if (audio.readyState >= 2) tryPlay();
      else audio.oncanplaythrough = tryPlay;
    });
  } catch (err) {
    URL.revokeObjectURL(url);
    throw err;
  }
  if (!started) throw new Error("Audio did not start");
}

/**
 * Play answer text via streaming TTS when possible, else sentence-level prefetch.
 */
async function playAnswerTts({
  text,
  speakFn,
  speakStreamFn,
  signal,
  prefetch = 2,
  onAudio,
  onSpeakingStart,
}) {
  const trimmed = String(text || "").trim();
  if (!trimmed) throw new Error("Nothing to speak");

  let spoke = false;
  const markStart = () => {
    if (!spoke) {
      spoke = true;
      if (onSpeakingStart) onSpeakingStart();
    }
  };

  const playOne = async (chunk, fn) => {
    const blob = await fn(chunk, signal);
    await playBlobAudio(blob, { signal, onAudio, onStart: markStart });
  };

  const synth = speakStreamFn || speakFn;
  if (!synth) throw new Error("No TTS function");

  // Short replies: one request — avoids sentence round-trip latency.
  if (trimmed.length <= 360) {
    try {
      await playOne(trimmed, synth);
      return;
    } catch (err) {
      if (speakFn && speakFn !== synth) {
        await playOne(trimmed, speakFn);
        return;
      }
      throw err;
    }
  }

  await playSentencePipeline({
    text: trimmed,
    speakFn: synth,
    fallbackSpeakFn: speakFn !== synth ? speakFn : null,
    signal,
    prefetch,
    onAudio,
    onSpeakingStart: markStart,
  });

  if (!spoke) throw new Error("Audio playback failed");
}

/**
 * Play answer text via sentence-level TTS with prefetch.
 */
async function playSentencePipeline({
  text,
  speakFn,
  fallbackSpeakFn,
  signal,
  prefetch = 2,
  onAudio,
  onSpeakingStart,
}) {
  const sentences = splitSentences(text);
  if (!sentences.length) return;

  let spoke = false;
  const markStart = () => {
    if (!spoke) {
      spoke = true;
      if (onSpeakingStart) onSpeakingStart();
    }
  };

  const jobs = new Array(sentences.length).fill(null);
  const fetchSentence = (sentence) =>
    speakFn(sentence, signal).catch(() => null);

  const ensure = (i) => {
    if (i >= 0 && i < sentences.length && jobs[i] === null) {
      jobs[i] = fetchSentence(sentences[i]);
    }
  };

  for (let i = 0; i < Math.min(prefetch, sentences.length); i += 1) ensure(i);

  for (let i = 0; i < sentences.length; i += 1) {
    if (signal?.aborted) break;
    ensure(i);
    for (let j = 1; j <= prefetch; j += 1) ensure(i + j);

    let blob = await jobs[i];
    if ((!blob || blob.size < 64) && fallbackSpeakFn) {
      blob = await fallbackSpeakFn(sentences[i], signal).catch(() => null);
    }
    if (!blob || blob.size < 64 || signal?.aborted) continue;

    await playBlobAudio(blob, { signal, onAudio, onStart: markStart });
  }

  if (!spoke) throw new Error("No audio played");
}
