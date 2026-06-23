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
 * Play answer text via sentence-level TTS with prefetch.
 * @param {object} opts
 * @param {string} opts.text
 * @param {(sentence: string, signal?: AbortSignal) => Promise<Blob>} opts.speakFn
 * @param {AbortSignal} [opts.signal]
 * @param {number} [opts.prefetch=2]
 */
async function playSentencePipeline({ text, speakFn, signal, prefetch = 2 }) {
  const sentences = splitSentences(text);
  if (!sentences.length) return;
  const jobs = new Array(sentences.length).fill(null);
  const ensure = (i) => {
    if (i >= 0 && i < sentences.length && jobs[i] === null) {
      jobs[i] = speakFn(sentences[i], signal).catch(() => null);
    }
  };
  for (let i = 0; i < Math.min(prefetch, sentences.length); i += 1) ensure(i);

  for (let i = 0; i < sentences.length; i += 1) {
    if (signal?.aborted) break;
    ensure(i);
    for (let j = 1; j <= prefetch; j += 1) ensure(i + j);
    const blob = await jobs[i];
    if (!blob || signal?.aborted) continue;
    const url = URL.createObjectURL(blob);
    await new Promise((resolve) => {
      const audio = new Audio(url);
      audio.onended = resolve;
      audio.onerror = resolve;
      audio.play().catch(() => resolve());
    });
    URL.revokeObjectURL(url);
  }
}
