"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type VoiceInputState = "idle" | "recording" | "transcribing" | "error";

function pickMimeType(): string {
  if (typeof MediaRecorder === "undefined") return "";
  const candidates = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/mp4",
    "audio/ogg;codecs=opus",
  ];
  for (const t of candidates) {
    if (MediaRecorder.isTypeSupported(t)) return t;
  }
  return "";
}

function extensionForMime(mime: string): string {
  if (mime.includes("mp4")) return "mp4";
  if (mime.includes("ogg")) return "ogg";
  return "webm";
}

/**
 * Micro → MediaRecorder → POST /api/v1/assistant/transcribe (Whisper).
 * Toggle : 1er clic = enregistre, 2e clic = stop + transcription.
 */
export function useVoiceInput(opts: {
  disabled?: boolean;
  onTranscript: (text: string) => void | Promise<void>;
  onError?: (message: string) => void;
}) {
  const [state, setState] = useState<VoiceInputState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [supported, setSupported] = useState(true);

  const mediaRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const onTranscriptRef = useRef(opts.onTranscript);
  const onErrorRef = useRef(opts.onError);

  useEffect(() => {
    onTranscriptRef.current = opts.onTranscript;
  }, [opts.onTranscript]);
  useEffect(() => {
    onErrorRef.current = opts.onError;
  }, [opts.onError]);

  useEffect(() => {
    const ok =
      typeof window !== "undefined" &&
      !!navigator.mediaDevices?.getUserMedia &&
      typeof MediaRecorder !== "undefined";
    setSupported(ok);
  }, []);

  const cleanupStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    mediaRef.current = null;
  }, []);

  useEffect(() => () => cleanupStream(), [cleanupStream]);

  const fail = useCallback(
    (message: string) => {
      setError(message);
      setState("error");
      onErrorRef.current?.(message);
      cleanupStream();
      window.setTimeout(() => {
        setState((s) => (s === "error" ? "idle" : s));
      }, 2500);
    },
    [cleanupStream],
  );

  const transcribeBlob = useCallback(
    async (blob: Blob, mime: string) => {
      setState("transcribing");
      setError(null);
      try {
        const ext = extensionForMime(mime);
        const file = new File([blob], `recording.${ext}`, {
          type: mime || "audio/webm",
        });
        const form = new FormData();
        form.append("file", file);

        const res = await fetch("/api/v1/assistant/transcribe", {
          method: "POST",
          body: form,
        });
        const data = (await res.json().catch(() => ({}))) as {
          text?: string;
          error?: string;
        };
        if (!res.ok) {
          throw new Error(data.error || `Erreur HTTP ${res.status}`);
        }
        const text = String(data.text || "").trim();
        if (!text) {
          throw new Error("Aucune parole détectée");
        }
        setState("idle");
        await onTranscriptRef.current(text);
      } catch (e) {
        fail(e instanceof Error ? e.message : "Transcription impossible");
      }
    },
    [fail],
  );

  const stopRecording = useCallback(() => {
    const rec = mediaRef.current;
    if (!rec || rec.state === "inactive") {
      setState("idle");
      cleanupStream();
      return;
    }
    rec.stop();
  }, [cleanupStream]);

  const startRecording = useCallback(async () => {
    if (opts.disabled || state === "transcribing") return;
    setError(null);
    try {
      const mime = pickMimeType();
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
        },
      });
      streamRef.current = stream;
      chunksRef.current = [];

      const rec = mime
        ? new MediaRecorder(stream, { mimeType: mime })
        : new MediaRecorder(stream);
      const usedMime = rec.mimeType || mime || "audio/webm";

      rec.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) chunksRef.current.push(e.data);
      };
      rec.onerror = () => {
        fail("Erreur d'enregistrement micro");
      };
      rec.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: usedMime });
        cleanupStream();
        if (blob.size < 200) {
          fail("Enregistrement trop court");
          return;
        }
        void transcribeBlob(blob, usedMime);
      };

      mediaRef.current = rec;
      rec.start();
      setState("recording");
    } catch (e) {
      const msg =
        e instanceof DOMException && e.name === "NotAllowedError"
          ? "Autorisez le micro dans le navigateur"
          : e instanceof Error
            ? e.message
            : "Micro indisponible";
      fail(msg);
    }
  }, [cleanupStream, fail, opts.disabled, state, transcribeBlob]);

  const toggle = useCallback(() => {
    if (opts.disabled || state === "transcribing") return;
    if (state === "recording") {
      stopRecording();
      return;
    }
    void startRecording();
  }, [opts.disabled, startRecording, state, stopRecording]);

  const cancel = useCallback(() => {
    const rec = mediaRef.current;
    if (rec && rec.state !== "inactive") {
      rec.onstop = null;
      try {
        rec.stop();
      } catch {
        /* ignore */
      }
    }
    cleanupStream();
    setState("idle");
    setError(null);
  }, [cleanupStream]);

  return {
    state,
    error,
    supported,
    recording: state === "recording",
    transcribing: state === "transcribing",
    toggle,
    cancel,
  };
}
