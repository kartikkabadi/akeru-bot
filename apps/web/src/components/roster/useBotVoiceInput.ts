import { useEffect, useLayoutEffect, useRef, useState } from "react";

const useBrowserLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

export function formatBotVoiceDuration(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(seconds % 60).padStart(2, "0")}`;
}

export function botVoiceErrorMessage(error: unknown): string {
  const name =
    typeof error === "object" && error !== null && "name" in error
      ? String(error.name)
      : String(error);
  if (
    name === "NotAllowedError" ||
    name === "PermissionDeniedError" ||
    name === "not-allowed" ||
    name === "service-not-allowed"
  ) {
    return "Microphone access denied. Enable microphone access in system settings.";
  }
  if (name === "NotFoundError" || name === "DevicesNotFoundError" || name === "audio-capture") {
    return "No microphone was found.";
  }
  if (name === "NotSupportedError") {
    return "Voice input is not supported in this browser.";
  }
  return "Could not start voice input.";
}

type BotVoiceState = "idle" | "starting" | "listening" | "stopping";

interface SpeechRecognitionAlternativeLike {
  readonly transcript: string;
}

interface SpeechRecognitionResultLike {
  readonly isFinal: boolean;
  readonly length: number;
  readonly [index: number]: SpeechRecognitionAlternativeLike;
}

interface SpeechRecognitionResultListLike {
  readonly length: number;
  readonly [index: number]: SpeechRecognitionResultLike;
}

interface SpeechRecognitionEventLike {
  readonly resultIndex: number;
  readonly results: SpeechRecognitionResultListLike;
}

interface BotSpeechRecognition {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  abort(): void;
  addEventListener(type: "end", listener: () => void): void;
  addEventListener(type: "error", listener: (event: { readonly error: string }) => void): void;
  addEventListener(type: "result", listener: (event: SpeechRecognitionEventLike) => void): void;
  start(): void;
  stop(): void;
}

type BotSpeechRecognitionConstructor = new () => BotSpeechRecognition;

function browserSpeechRecognition(): BotSpeechRecognitionConstructor | null {
  const browserWindow = window as typeof window & {
    SpeechRecognition?: BotSpeechRecognitionConstructor;
    webkitSpeechRecognition?: BotSpeechRecognitionConstructor;
  };
  return browserWindow.SpeechRecognition ?? browserWindow.webkitSpeechRecognition ?? null;
}

export function useBotVoiceInput(input: {
  readonly draft: string;
  readonly resetKey: string | undefined;
  readonly onDraftChange: (draft: string) => void;
}) {
  const [state, setState] = useState<BotVoiceState>("idle");
  const [seconds, setSeconds] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const recognitionRef = useRef<BotSpeechRecognition | null>(null);
  const sessionRef = useRef(0);
  const draftRef = useRef(input.draft);
  const onDraftChangeRef = useRef(input.onDraftChange);
  const baseDraftRef = useRef("");
  const finalTranscriptRef = useRef("");
  draftRef.current = input.draft;
  onDraftChangeRef.current = input.onDraftChange;

  const cancel = () => {
    sessionRef.current += 1;
    const recognition = recognitionRef.current;
    recognitionRef.current = null;
    setState("idle");
    recognition?.abort();
  };

  const stop = () => {
    if (state === "starting") {
      cancel();
      return;
    }
    const recognition = recognitionRef.current;
    if (!recognition) {
      setState("idle");
      return;
    }
    setState("stopping");
    recognition.stop();
  };

  const start = async () => {
    const session = sessionRef.current + 1;
    sessionRef.current = session;
    setError(null);
    setState("starting");
    setSeconds(0);
    try {
      const Recognition = browserSpeechRecognition();
      if (!Recognition || !navigator.mediaDevices?.getUserMedia) {
        const unsupported = new Error("Voice input is unavailable.");
        unsupported.name = "NotSupportedError";
        throw unsupported;
      }
      const permissionStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      for (const track of permissionStream.getTracks()) track.stop();
      if (sessionRef.current !== session) return;

      const recognition = new Recognition();
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = navigator.language;
      baseDraftRef.current = draftRef.current.trimEnd();
      finalTranscriptRef.current = "";
      recognition.addEventListener("result", (event) => {
        if (sessionRef.current !== session || recognitionRef.current !== recognition) return;
        let interimTranscript = "";
        for (let index = event.resultIndex; index < event.results.length; index++) {
          const result = event.results[index];
          const transcript = result?.[0]?.transcript.trim() ?? "";
          if (!transcript) continue;
          if (result?.isFinal) {
            finalTranscriptRef.current = `${finalTranscriptRef.current} ${transcript}`.trim();
          } else {
            interimTranscript = `${interimTranscript} ${transcript}`.trim();
          }
        }
        const spoken = `${finalTranscriptRef.current} ${interimTranscript}`.trim();
        const base = baseDraftRef.current;
        onDraftChangeRef.current(base && spoken ? `${base} ${spoken}` : base || spoken);
      });
      recognition.addEventListener("error", (event) => {
        if (sessionRef.current !== session || recognitionRef.current !== recognition) return;
        recognitionRef.current = null;
        setError(botVoiceErrorMessage(event.error));
        setState("idle");
      });
      recognition.addEventListener("end", () => {
        if (sessionRef.current !== session || recognitionRef.current !== recognition) return;
        recognitionRef.current = null;
        setState("idle");
      });
      recognitionRef.current = recognition;
      recognition.start();
      setState("listening");
    } catch (cause) {
      if (sessionRef.current !== session) return;
      recognitionRef.current = null;
      setState("idle");
      setError(botVoiceErrorMessage(cause));
    }
  };

  useBrowserLayoutEffect(() => {
    sessionRef.current += 1;
    const recognition = recognitionRef.current;
    recognitionRef.current = null;
    recognition?.abort();
    setState("idle");
    setSeconds(0);
    setError(null);
  }, [input.resetKey]);

  useEffect(() => {
    if (state !== "listening") return;
    const interval = window.setInterval(() => setSeconds((current) => current + 1), 1_000);
    return () => window.clearInterval(interval);
  }, [state]);

  useBrowserLayoutEffect(
    () => () => {
      sessionRef.current += 1;
      const recognition = recognitionRef.current;
      recognitionRef.current = null;
      recognition?.abort();
    },
    [],
  );

  return { state, seconds, error, start, stop, cancel } as const;
}
