"use strict";

/** All in-flight TTS `<audio>` elements — stop together on interrupt. */
const activePlaybackAudios = new Set();

function stopAllPlayback() {
  for (const audio of activePlaybackAudios) {
    try {
      audio.pause();
      audio.currentTime = 0;
    } catch (_) {}
  }
  activePlaybackAudios.clear();
}

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
      activePlaybackAudios.add(audio);
      if (onAudio) onAudio(audio);

      const finish = (err) => {
        activePlaybackAudios.delete(audio);
        if (onAudio) onAudio(null);
        URL.revokeObjectURL(url);
        if (err) reject(err);
        else resolve();
      };

      if (signal) {
        if (signal.aborted) {
          finish();
          return;
        }
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

/** Pull the next complete sentence from incremental LLM text. */
function pullNextSentence(fullText, spokenUpTo) {
  const rest = fullText.slice(spokenUpTo);
  if (!rest.trim()) return null;
  const match = rest.match(/^[\s\S]*?[.!?]+["')\]]*\s+/);
  if (match && match[0].trim().length >= 6) {
    return { sentence: match[0].trim(), nextUpTo: spokenUpTo + match[0].length };
  }
  return null;
}

async function consumeSseResponse(response, onEvent, signal) {
  if (!response.body) throw new Error("No stream body");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    if (signal?.aborted) break;
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let sep;
    while ((sep = buffer.indexOf("\n\n")) !== -1) {
      const block = buffer.slice(0, sep);
      buffer = buffer.slice(sep + 2);
      for (const line of block.split("\n")) {
        if (!line.startsWith("data: ")) continue;
        try {
          onEvent(JSON.parse(line.slice(6)));
        } catch (_) {}
      }
    }
  }
}

/**
 * Stream an orb turn (SSE) and start TTS as soon as the first sentence is ready.
 */
async function streamOrbTurnAndSpeak({
  response,
  speakFn,
  speakStreamFn,
  signal,
  onAudio,
  onSpeakingStart,
  onMeta,
}) {
  const synth = speakStreamFn || speakFn;
  if (!synth) throw new Error("No TTS function");

  let fullText = "";
  let spokenUpTo = 0;
  let spoke = false;
  let completeTurn = null;
  let streamError = null;
  const sentenceQueue = [];
  let streamDone = false;
  const prefetch = new Map();

  const markStart = () => {
    if (!spoke) {
      spoke = true;
      if (onSpeakingStart) onSpeakingStart();
    }
  };

  const synthSentence = async (sentence) => {
    if (prefetch.has(sentence)) {
      const blob = await prefetch.get(sentence);
      prefetch.delete(sentence);
      if (blob && blob.size >= 64) return blob;
    }
    let blob = await synth(sentence, signal).catch(() => null);
    if ((!blob || blob.size < 64) && speakFn && speakFn !== synth) {
      blob = await speakFn(sentence, signal).catch(() => null);
    }
    return blob && blob.size >= 64 ? blob : null;
  };

  const schedulePrefetch = (sentence) => {
    if (!prefetch.has(sentence)) {
      prefetch.set(
        sentence,
        synth(sentence, signal)
          .then((blob) => {
            if (blob && blob.size >= 64) return blob;
            if (speakFn && speakFn !== synth) {
              return speakFn(sentence, signal).catch(() => null);
            }
            return null;
          })
          .catch(() => null),
      );
    }
  };

  function enqueueNewSentences() {
    while (true) {
      const pulled = pullNextSentence(fullText, spokenUpTo);
      if (!pulled) break;
      sentenceQueue.push(pulled.sentence);
      spokenUpTo = pulled.nextUpTo;
    }
    if (sentenceQueue.length > 0) {
      schedulePrefetch(sentenceQueue[sentenceQueue.length - 1]);
    }
  }

  async function drainQueue() {
    while (!streamDone || sentenceQueue.length > 0) {
      if (signal?.aborted) break;
      if (sentenceQueue.length === 0) {
        await new Promise((r) => setTimeout(r, 35));
        continue;
      }
      const sentence = sentenceQueue.shift();
      if (sentenceQueue.length > 0) schedulePrefetch(sentenceQueue[0]);
      const blob = await synthSentence(sentence);
      if (blob) await playBlobAudio(blob, { signal, onAudio, onStart: markStart });
    }
    const tail = fullText.slice(spokenUpTo).trim();
    if (tail.length >= 4 && !signal?.aborted) {
      spokenUpTo = fullText.length;
      const blob = await synthSentence(tail);
      if (blob) await playBlobAudio(blob, { signal, onAudio, onStart: markStart });
    }
  }

  const drainPromise = drainQueue();

  await consumeSseResponse(
    response,
    (ev) => {
      if (ev.type === "error") {
        streamError = new Error(ev.message || "Stream error");
        streamDone = true;
        return;
      }
      if (ev.type === "meta") {
        if (onMeta) onMeta(ev);
      } else if (ev.type === "delta") {
        fullText += ev.content || "";
        enqueueNewSentences();
      } else if (ev.type === "complete") {
        completeTurn = ev;
        if (ev.answer && !fullText) fullText = String(ev.answer);
        else if (ev.answer && fullText.length < String(ev.answer).length) {
          fullText = String(ev.answer);
        }
        enqueueNewSentences();
        streamDone = true;
      }
    },
    signal,
  );

  streamDone = true;
  await drainPromise;

  if (streamError) throw streamError;
  if (!completeTurn) throw new Error("Incomplete stream");

  if (!spoke && completeTurn.answer) {
    await playAnswerTts({
      text: completeTurn.answer,
      speakFn,
      speakStreamFn,
      signal,
      prefetch: 3,
      onAudio,
      onSpeakingStart: markStart,
    });
  }

  if (!spoke) throw new Error("Audio playback failed");
  return completeTurn;
}

/**
 * Speak LLM deltas as they arrive (WebSocket or local push).
 * Returns a controller with pushDelta / finish / abort.
 */
function createDeltaStreamingSpeaker({
  speakFn,
  speakStreamFn,
  signal,
  onAudio,
  onSpeakingStart,
}) {
  const synth = speakStreamFn || speakFn;
  let fullText = "";
  let spokenUpTo = 0;
  let spoke = false;
  let finished = false;
  let aborted = false;
  const sentenceQueue = [];
  const prefetch = new Map();

  const markStart = () => {
    if (!spoke) {
      spoke = true;
      if (onSpeakingStart) onSpeakingStart();
    }
  };

  const synthSentence = async (sentence) => {
    if (prefetch.has(sentence)) {
      const blob = await prefetch.get(sentence);
      prefetch.delete(sentence);
      if (blob && blob.size >= 64) return blob;
    }
    let blob = await synth(sentence, signal).catch(() => null);
    if ((!blob || blob.size < 64) && speakFn && speakFn !== synth) {
      blob = await speakFn(sentence, signal).catch(() => null);
    }
    return blob && blob.size >= 64 ? blob : null;
  };

  const schedulePrefetch = (sentence) => {
    if (!prefetch.has(sentence)) {
      prefetch.set(
        sentence,
        synth(sentence, signal)
          .then((blob) => {
            if (blob && blob.size >= 64) return blob;
            if (speakFn && speakFn !== synth) {
              return speakFn(sentence, signal).catch(() => null);
            }
            return null;
          })
          .catch(() => null),
      );
    }
  };

  function enqueueNewSentences() {
    while (true) {
      const pulled = pullNextSentence(fullText, spokenUpTo);
      if (!pulled) break;
      sentenceQueue.push(pulled.sentence);
      spokenUpTo = pulled.nextUpTo;
    }
    if (sentenceQueue.length > 0) {
      schedulePrefetch(sentenceQueue[sentenceQueue.length - 1]);
    }
  }

  async function drainQueue() {
    while (!finished || sentenceQueue.length > 0) {
      if (aborted || signal?.aborted) break;
      if (sentenceQueue.length === 0) {
        await new Promise((r) => setTimeout(r, 30));
        continue;
      }
      const sentence = sentenceQueue.shift();
      if (sentenceQueue.length > 0) schedulePrefetch(sentenceQueue[0]);
      const blob = await synthSentence(sentence);
      if (blob) await playBlobAudio(blob, { signal, onAudio, onStart: markStart });
    }
    const tail = fullText.slice(spokenUpTo).trim();
    if (tail.length >= 4 && !aborted && !signal?.aborted) {
      spokenUpTo = fullText.length;
      const blob = await synthSentence(tail);
      if (blob) await playBlobAudio(blob, { signal, onAudio, onStart: markStart });
    }
  }

  const drainPromise = drainQueue();

  return {
    pushDelta(text) {
      if (aborted || finished) return;
      fullText += text || "";
      enqueueNewSentences();
    },
    async finish(completeTurn) {
      if (completeTurn?.answer && fullText.length < String(completeTurn.answer).length) {
        fullText = String(completeTurn.answer);
      }
      enqueueNewSentences();
      finished = true;
      await drainPromise;
      if (!spoke && completeTurn?.answer) {
        await playAnswerTts({
          text: completeTurn.answer,
          speakFn,
          speakStreamFn,
          signal,
          prefetch: 3,
          onAudio,
          onSpeakingStart: markStart,
        });
      }
      if (!spoke) throw new Error("Audio playback failed");
      return completeTurn;
    },
    abort() {
      aborted = true;
      finished = true;
      prefetch.clear();
      stopAllPlayback();
    },
  };
}
