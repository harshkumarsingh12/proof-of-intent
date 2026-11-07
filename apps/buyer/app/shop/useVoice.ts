"use client";

/**
 * The browser side of voice ordering (docs/specs/0010): the Web Speech API behind a small hook, and nothing else.
 * It makes no decisions: what a transcript means, and whether anything is signed, is `src/voice.ts`.
 *
 * Chrome, Edge and Safari have it (HTTPS or localhost only); Firefox does not, so `supported` is false there and the
 * shop hides the microphone. The browser vendor processes the audio. Start listening only from a click.
 */
import { useCallback, useEffect, useRef, useState } from "react";

interface RecognitionResult {
  isFinal: boolean;
  0: { transcript: string };
}
interface RecognitionEvent {
  resultIndex: number;
  results: { length: number; [index: number]: RecognitionResult };
}
interface Recognition {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((event: RecognitionEvent) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}
type RecognitionConstructor = new () => Recognition;

const recognitionConstructor = (): RecognitionConstructor | undefined => {
  const w = window as unknown as {
    SpeechRecognition?: RecognitionConstructor;
    webkitSpeechRecognition?: RecognitionConstructor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition;
};

/** What the shopper is told when recognition fails. Typing always works, and every message says so or is retryable. */
const ERRORS: Record<string, string> = {
  "not-allowed": "Microphone access was blocked, so I can't listen. You can type instead.",
  "service-not-allowed": "This browser won't let the page listen. You can type instead.",
  "no-speech": "I didn't hear anything. Try again, or type it.",
  "audio-capture": "I couldn't find a microphone. You can type instead.",
  network: "Speech recognition needs a connection. You can type instead.",
  "language-not-supported": "This browser can't recognize English here. You can type instead.",
};

export interface ListenHandlers {
  /** Interim results have `final` false; a spoken request is complete at the first final result. */
  onResult: (text: string, final: boolean) => void;
  /** The session is over (silence, a final result, an error, stop). `error` is a message for the shopper, if any. */
  onEnd: (error?: string) => void;
}

export interface Speech {
  /** The browser has been checked (after mount). Until then `supported` is false only because nobody looked yet. */
  ready: boolean;
  /** Speech recognition exists in this browser. False on the server render and until mounted. */
  supported: boolean;
  /** Speaking the read-back aloud is possible. */
  canSpeak: boolean;
  /** One recognition session: it ends by itself after the shopper stops talking. Replaces a running one. */
  listen: (handlers: ListenHandlers) => void;
  stop: () => void;
  /** Reads `text` aloud, with the microphone off meanwhile (so the shop can't hear its own "confirm"), then `onDone`. */
  speak: (text: string, onDone: () => void) => void;
}

export function useSpeech(): Speech {
  const [ready, setReady] = useState(false);
  const [supported, setSupported] = useState(false);
  const [canSpeak, setCanSpeak] = useState(false);
  const active = useRef<Recognition | null>(null);

  // Feature-detect after mount, so the server render and the first client render agree.
  useEffect(() => {
    setSupported(recognitionConstructor() !== undefined);
    setReady(true);
    setCanSpeak(
      typeof window.speechSynthesis !== "undefined" && typeof SpeechSynthesisUtterance !== "undefined",
    );
    return () => {
      active.current?.abort();
      if (typeof window.speechSynthesis !== "undefined") window.speechSynthesis.cancel();
    };
  }, []);

  const stop = useCallback(() => {
    active.current?.abort();
    active.current = null;
    if (typeof window.speechSynthesis !== "undefined") window.speechSynthesis.cancel();
  }, []);

  const listen = useCallback((handlers: ListenHandlers) => {
    const Ctor = recognitionConstructor();
    if (!Ctor) {
      handlers.onEnd("Voice input isn't available in this browser. You can type instead.");
      return;
    }
    active.current?.abort();
    const recognition = new Ctor();
    recognition.lang = "en-US";
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;
    let failure: string | undefined;
    recognition.onresult = (event) => {
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (result) handlers.onResult(result[0].transcript, result.isFinal);
      }
    };
    recognition.onerror = (event) => {
      // "aborted" is us stopping it; everything else the shopper should hear about.
      if (event.error !== "aborted")
        failure = ERRORS[event.error] ?? "Voice input stopped. You can type instead.";
    };
    recognition.onend = () => {
      if (active.current === recognition) active.current = null;
      handlers.onEnd(failure);
    };
    active.current = recognition;
    try {
      recognition.start();
    } catch {
      active.current = null;
      handlers.onEnd("Voice input couldn't start. You can type instead.");
    }
  }, []);

  const speak = useCallback((text: string, onDone: () => void) => {
    if (typeof window.speechSynthesis === "undefined" || typeof SpeechSynthesisUtterance === "undefined") {
      onDone();
      return;
    }
    active.current?.abort();
    active.current = null;
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = "en-US";
    utterance.onend = onDone;
    utterance.onerror = onDone;
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utterance);
  }, []);

  return { ready, supported, canSpeak, listen, stop, speak };
}
