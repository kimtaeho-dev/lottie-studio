import { createContext, createResource, createSignal, useContext, type JSX } from "solid-js";
import { useParams } from "@solidjs/router";
import type { ChatMessage, ChatProgress, ChatSettings } from "@/types";
import { onServerEvent } from "@/lib/live";

/** A file staged for the next outgoing message, read as text client-side (SVG only). */
export interface PendingAttachment {
  name: string;
  content: string;
}

const SETTINGS_KEY = "lottie-studio.chat-settings";
const DEFAULT_SETTINGS: ChatSettings = { model: "sonnet", effort: "medium" };

/** How many past turns the "usually takes about this long" hint averages over. */
const DURATION_SAMPLE = 5;

const ChatContext = createContext<{
  messages: () => ChatMessage[];
  sending: () => boolean;
  /** Live status of the turn currently running, when one is. */
  progress: () => ChatProgress | null;
  /** Median duration of recent successful turns, in ms; undefined until there are any. */
  typicalDurationMs: () => number | undefined;
  settings: () => ChatSettings;
  setSettings: (next: ChatSettings) => void;
  send: (text: string, attachment?: PendingAttachment) => Promise<void>;
  cancel: (messageId: string) => Promise<void>;
  /** Send a failed request again, unchanged. */
  retry: (messageId: string) => Promise<void>;
  /** Ask the host to open its sign-in window; false when it has none. */
  signIn: () => Promise<boolean>;
  reset: () => Promise<void>;
}>();

async function loadMessages(project: string | undefined): Promise<ChatMessage[]> {
  if (!project) return [];
  const res = await fetch(`/__chat?project=${encodeURIComponent(project)}`);
  if (!res.ok) throw new Error(`Failed to load chat for ${project} (HTTP ${res.status})`);
  return (await res.json()) as ChatMessage[];
}

/** The stored choice, ignoring anything this version no longer offers. */
function loadSettings(): ChatSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<ChatSettings>;
    return {
      model: parsed.model ?? DEFAULT_SETTINGS.model,
      effort: parsed.effort ?? DEFAULT_SETTINGS.effort,
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function ChatProvider(props: { children: JSX.Element }) {
  const params = useParams();
  // Keyed on the active project so switching projects switches conversations.
  const [data, { mutate }] = createResource(() => params.project, loadMessages, { initialValue: [] });
  const [sending, setSending] = createSignal(false);
  const [progress, setProgress] = createSignal<ChatProgress | null>(null);
  const [settings, setSettingsSignal] = createSignal<ChatSettings>(loadSettings());

  const setSettings = (next: ChatSettings) => {
    setSettingsSignal(next);
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
    } catch {
      // A browser with storage disabled just forgets the choice on reload.
    }
  };

  onServerEvent<{ project: string; messages: ChatMessage[] }>("chat:update", (payload) => {
    if (payload.project === params.project) mutate(payload.messages);
  });

  onServerEvent<ChatProgress>("chat:progress", (payload) => {
    if (payload.project !== params.project) return;
    // An empty step is the server saying this turn is over.
    setProgress(payload.step ? payload : null);
  });

  const send = async (text: string, attachment?: PendingAttachment) => {
    const project = params.project;
    if (!project) return;
    setSending(true);
    try {
      await fetch("/__chat/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ project, text, attachment, settings: settings() }),
      });
    } finally {
      setSending(false);
    }
  };

  const cancel = async (messageId: string) => {
    const project = params.project;
    if (!project) return;
    await fetch("/__chat/cancel", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ project, messageId }),
    });
  };

  const retry = async (messageId: string) => {
    const project = params.project;
    if (!project) return;
    await fetch("/__chat/retry", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ project, messageId }),
    });
  };

  const signIn = async () => {
    const res = await fetch("/__chat/signin", { method: "POST" });
    if (!res.ok) return false;
    return ((await res.json()) as { ok?: boolean }).ok === true;
  };

  const reset = async () => {
    const project = params.project;
    if (!project) return;
    setProgress(null);
    await fetch("/__chat/reset", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ project }),
    });
  };

  const messages = () => data() ?? [];

  // Median rather than mean: one 12-minute outlier should not move the hint
  // the panel shows on every subsequent turn.
  const typicalDurationMs = () => {
    const samples = messages()
      .map((m) => m.durationMs)
      .filter((d): d is number => typeof d === "number" && d > 0)
      .slice(-DURATION_SAMPLE)
      .sort((a, b) => a - b);
    if (samples.length === 0) return undefined;
    return samples[Math.floor(samples.length / 2)];
  };

  return (
    <ChatContext.Provider
      value={{ messages, sending, progress, typicalDurationMs, settings, setSettings, send, cancel, retry, signIn, reset }}
    >
      {props.children}
    </ChatContext.Provider>
  );
}

export function useChat() {
  const context = useContext(ChatContext);
  if (!context) {
    throw new Error("useChat must be used within a ChatProvider");
  }
  return context;
}
