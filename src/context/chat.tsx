import { createContext, createResource, createSignal, useContext, type JSX } from "solid-js";
import { useParams } from "@solidjs/router";
import type { ChatMessage } from "@/types";
import { onServerEvent } from "@/lib/live";

/** A file staged for the next outgoing message, read as text client-side (SVG only). */
export interface PendingAttachment {
  name: string;
  content: string;
}

const ChatContext = createContext<{
  messages: () => ChatMessage[];
  sending: () => boolean;
  send: (text: string, attachment?: PendingAttachment) => Promise<void>;
  cancel: (messageId: string) => Promise<void>;
  reset: () => Promise<void>;
}>();

async function loadMessages(project: string | undefined): Promise<ChatMessage[]> {
  if (!project) return [];
  const res = await fetch(`/__chat?project=${encodeURIComponent(project)}`);
  if (!res.ok) throw new Error(`Failed to load chat for ${project} (HTTP ${res.status})`);
  return (await res.json()) as ChatMessage[];
}

export function ChatProvider(props: { children: JSX.Element }) {
  const params = useParams();
  // Keyed on the active project so switching projects switches conversations.
  const [data, { mutate }] = createResource(() => params.project, loadMessages, { initialValue: [] });
  const [sending, setSending] = createSignal(false);

  onServerEvent<{ project: string; messages: ChatMessage[] }>("chat:update", (payload) => {
    if (payload.project === params.project) mutate(payload.messages);
  });

  const send = async (text: string, attachment?: PendingAttachment) => {
    const project = params.project;
    if (!project) return;
    setSending(true);
    try {
      await fetch("/__chat/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ project, text, attachment }),
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

  const reset = async () => {
    const project = params.project;
    if (!project) return;
    await fetch("/__chat/reset", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ project }),
    });
  };

  const messages = () => data() ?? [];

  return (
    <ChatContext.Provider value={{ messages, sending, send, cancel, reset }}>{props.children}</ChatContext.Provider>
  );
}

export function useChat() {
  const context = useContext(ChatContext);
  if (!context) {
    throw new Error("useChat must be used within a ChatProvider");
  }
  return context;
}
