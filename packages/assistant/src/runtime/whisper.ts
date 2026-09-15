/**
 * Transcription audio → texte via OpenAI Whisper (ou modèle compatible).
 */

const OPENAI_TRANSCRIBE_URL = "https://api.openai.com/v1/audio/transcriptions";
const MAX_AUDIO_BYTES = 25 * 1024 * 1024; // limite API Whisper

export function whisperModel(): string {
  return (process.env.OPENAI_WHISPER_MODEL || "whisper-1").trim() || "whisper-1";
}

export async function transcribeAudio(
  file: File | Blob,
  opts?: { filename?: string; language?: string; signal?: AbortSignal },
): Promise<{ text: string; model: string }> {
  const key = (process.env.OPENAI_API_KEY || "").trim();
  if (!key) {
    throw new Error("OPENAI_API_KEY manquante");
  }

  const size = file.size;
  if (!size || size <= 0) {
    throw new Error("Fichier audio vide");
  }
  if (size > MAX_AUDIO_BYTES) {
    throw new Error("Audio trop volumineux (max 25 Mo)");
  }

  const filename =
    opts?.filename ||
    (file instanceof File && file.name ? file.name : "recording.webm");

  const form = new FormData();
  form.append("file", file, filename);
  form.append("model", whisperModel());
  form.append("language", opts?.language || "fr");
  form.append("response_format", "json");

  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 60000);
  const onParentAbort = () => ctrl.abort();
  if (opts?.signal) {
    if (opts.signal.aborted) ctrl.abort();
    else opts.signal.addEventListener("abort", onParentAbort, { once: true });
  }

  try {
    const res = await fetch(OPENAI_TRANSCRIBE_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}` },
      body: form,
      signal: ctrl.signal,
      
    });

    const raw = await res.text();
    let data: { text?: string; error?: { message?: string } } = {};
    try {
      data = JSON.parse(raw) as typeof data;
    } catch {
      /* ignore */
    }

    if (!res.ok) {
      const detail = data.error?.message || raw.slice(0, 240) || `HTTP ${res.status}`;
      throw new Error(`Whisper: ${detail}`);
    }

    const text = String(data.text || "").trim();
    if (!text) {
      throw new Error("Aucune parole détectée");
    }
    return { text, model: whisperModel() };
  } finally {
    clearTimeout(t);
    if (opts?.signal) opts.signal.removeEventListener("abort", onParentAbort);
  }
}
