import { API_URL, getToken } from "./auth";

/**
 * Jarvis-style proactive voice. Fetches the spoken briefing for the current
 * user's pending proactive events and plays it. Browsers block autoplay without
 * a user gesture, so callers should invoke this from a gesture (notification
 * click landing, or an in-app "Listen" affordance) or accept that play() may
 * reject — in which case we resolve quietly.
 */
let _playing = false;

export async function playProactiveVoice(
  voicePath = "/api/v1/proactive/voice",
): Promise<boolean> {
  if (_playing) return false;
  const token = getToken();
  if (!token) return false;

  _playing = true;
  try {
    const res = await fetch(`${API_URL}${voicePath}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return false;
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    audio.addEventListener("ended", () => URL.revokeObjectURL(url), { once: true });
    try {
      await audio.play();
      return true;
    } catch {
      // Autoplay blocked — no gesture available. Caller can retry on interaction.
      URL.revokeObjectURL(url);
      return false;
    }
  } catch {
    return false;
  } finally {
    _playing = false;
  }
}
