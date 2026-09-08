import { createEffect, createSignal, For, Show } from "solid-js";
import { Paperclip, RotateCcw, Send, X } from "lucide-solid";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { useChat, type PendingAttachment } from "@/context/chat";

const MAX_TEXTAREA_HEIGHT = 128; // px — grows up to this, then scrolls internally

// Kept in sync with MAX_ATTACHMENT_BYTES in vite-plugins/mailbox.ts — checked
// client-side too so a huge file fails fast instead of round-tripping.
const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;

export function ChatPanel() {
  const { messages, sending, send, cancel, reset } = useChat();
  const [text, setText] = createSignal("");
  const [attachment, setAttachment] = createSignal<PendingAttachment | null>(null);
  const [attachError, setAttachError] = createSignal<string | null>(null);
  const [dragActive, setDragActive] = createSignal(false);
  let listRef: HTMLDivElement | undefined;
  let textareaRef: HTMLTextAreaElement | undefined;
  let fileInputRef: HTMLInputElement | undefined;
  // Counts nested dragenter/dragleave pairs so hovering over a child element
  // (the message list, the textarea, ...) doesn't prematurely clear the
  // "dragging a file over the panel" state — only reaching 0 means the
  // pointer actually left the panel.
  let dragDepth = 0;

  const autoGrow = () => {
    if (!textareaRef) return;
    textareaRef.style.height = "auto";
    textareaRef.style.height = `${Math.min(textareaRef.scrollHeight, MAX_TEXTAREA_HEIGHT)}px`;
  };

  const loadAttachment = async (file: File) => {
    setAttachError(null);
    if (!/\.svg$/i.test(file.name)) {
      setAttachError("SVG 파일만 첨부할 수 있어요.");
      return;
    }
    if (file.size > MAX_ATTACHMENT_BYTES) {
      setAttachError("파일이 너무 커요. 5MB 이하 SVG만 첨부할 수 있어요.");
      return;
    }
    const content = await file.text();
    setAttachment({ name: file.name, content });
  };

  const handleFileInput = (e: Event) => {
    const input = e.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = ""; // reset so picking the same file again still fires a change
    if (file) void loadAttachment(file);
  };

  const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes("Files");

  const handleDragEnter = (e: DragEvent) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    dragDepth++;
    setDragActive(true);
  };

  const handleDragOver = (e: DragEvent) => {
    // Required for the element to be a valid drop target at all.
    if (!hasFiles(e)) return;
    e.preventDefault();
  };

  const handleDragLeave = (e: DragEvent) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    dragDepth = Math.max(0, dragDepth - 1);
    if (dragDepth === 0) setDragActive(false);
  };

  const handleDrop = (e: DragEvent) => {
    e.preventDefault();
    dragDepth = 0;
    setDragActive(false);
    const file = e.dataTransfer?.files?.[0];
    if (file) void loadAttachment(file);
  };

  const handleSend = async () => {
    const value = text().trim();
    const pending = attachment();
    if ((!value && !pending) || sending()) return;
    setText("");
    setAttachment(null);
    setAttachError(null);
    autoGrow();
    await send(value, pending ?? undefined);
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    // While an IME composition is active (typing Korean via 한글 입력기), the
    // Enter that confirms the composed syllable block must not also submit —
    // let it through and wait for the next, real Enter.
    if (e.isComposing) return;
    // Enter sends; Shift+Enter inserts a newline.
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void handleSend();
    }
  };

  // Keep the latest message in view as the thread grows.
  createEffect(() => {
    messages();
    listRef?.scrollTo({ top: listRef.scrollHeight });
  });

  return (
    <div
      class="relative flex flex-col flex-1 min-h-0 w-[380px] rounded-2xl gap-0 bg-background border border-border"
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <Show when={dragActive()}>
        <div class="absolute inset-0 z-10 flex items-center justify-center rounded-2xl border-2 border-dashed border-foreground bg-background/90 pointer-events-none">
          <span class="text-xxs font-strong text-foreground">여기에 SVG 파일을 놓아주세요</span>
        </div>
      </Show>

      <div class="flex items-center justify-between h-12 px-3 pl-4 border-b border-border shrink-0">
        <span class="text-xxs font-strong text-foreground">에이전트</span>
        <Show when={messages().length > 0}>
          <AlertDialog>
            <AlertDialogTrigger as={Button} size="icon" variant="ghost" aria-label="세션 초기화">
              <RotateCcw />
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>세션을 초기화할까요?</AlertDialogTitle>
                <AlertDialogDescription>지금까지 나눈 대화가 모두 사라져요. 새로 시작할까요?</AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>취소</AlertDialogCancel>
                <AlertDialogAction variant="destructive" onClick={() => void reset()}>
                  초기화
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </Show>
      </div>

      <div ref={listRef} class="flex-1 min-h-0 overflow-y-auto flex flex-col gap-2 px-3 py-3">
        <Show
          when={messages().length > 0}
          fallback={
            <div class="flex flex-col gap-1 px-1">
              <span class="text-xxs text-foreground">원하는 걸 편하게 말씀해 주세요.</span>
              <span class="text-xxs text-muted-foreground">
                예: "배경을 파란색으로 바꿔줘", "폭죽이 더 통통 튀게 해줘"
              </span>
              <span class="text-xxs text-muted-foreground">SVG 파일을 끌어다 놓거나 첨부해서 그걸 기반으로도 만들 수 있어요.</span>
            </div>
          }
        >
          <For each={messages()}>
            {(message) => (
              <div class="flex" classList={{ "justify-end": message.role === "user" }}>
                <div
                  class="max-w-[85%] rounded-lg px-2.5 py-1.5 text-xxs whitespace-pre-wrap break-words"
                  classList={{
                    "bg-foreground text-background": message.role === "user",
                    "bg-muted text-foreground": message.role === "assistant" && message.status !== "error",
                    "bg-destructive/10 text-destructive": message.status === "error",
                  }}
                >
                  <Show when={message.attachment}>
                    {(att) => (
                      <a
                        href={att().url}
                        target="_blank"
                        rel="noreferrer"
                        class="mb-1 flex items-center gap-1 underline underline-offset-2 opacity-80 hover:opacity-100"
                      >
                        <Paperclip class="size-3 shrink-0" />
                        <span class="truncate">{att().name}</span>
                      </a>
                    )}
                  </Show>
                  <Show when={message.status === "pending" || message.status === "processing"}>
                    <div class="flex items-center gap-1.5 text-muted-foreground">
                      <span>{message.status === "pending" ? "대기 중…" : "생각 중…"}</span>
                      <button
                        type="button"
                        onClick={() => cancel(message.id)}
                        class="inline-flex items-center justify-center rounded-sm hover:text-foreground focus-ring"
                        aria-label="요청 취소"
                      >
                        <X class="size-3.5" />
                      </button>
                    </div>
                  </Show>
                  <Show when={message.status === "cancelled"}>
                    <span class="text-muted-foreground italic">요청을 취소했어요.</span>
                  </Show>
                  <Show when={message.status === "done" || message.status === "error"}>{message.text}</Show>
                </div>
              </div>
            )}
          </For>
        </Show>
      </div>

      <Show when={attachment() || attachError()}>
        <div class="px-3 pt-2 shrink-0">
          <Show when={attachment()}>
            {(att) => (
              <div class="flex w-fit max-w-full items-center gap-1.5 rounded-md bg-muted px-2 py-1 text-xxs text-foreground">
                <Paperclip class="size-3.5 shrink-0" />
                <span class="truncate">{att().name}</span>
                <button
                  type="button"
                  onClick={() => setAttachment(null)}
                  class="inline-flex items-center justify-center rounded-sm hover:text-destructive focus-ring"
                  aria-label="첨부 제거"
                >
                  <X class="size-3.5" />
                </button>
              </div>
            )}
          </Show>
          <Show when={attachError()}>
            <span class="text-xxs text-destructive">{attachError()}</span>
          </Show>
        </div>
      </Show>

      <div class="flex items-end gap-1.5 px-3 py-2 border-t border-border shrink-0">
        <input ref={fileInputRef} type="file" accept=".svg,image/svg+xml" class="hidden" onChange={handleFileInput} />
        <Button size="icon" variant="ghost" onClick={() => fileInputRef?.click()} aria-label="SVG 파일 첨부">
          <Paperclip />
        </Button>
        <textarea
          ref={textareaRef}
          rows={1}
          value={text()}
          onInput={(e) => {
            setText(e.currentTarget.value);
            autoGrow();
          }}
          onKeyDown={handleKeyDown}
          placeholder="예: 배경을 파란색으로 바꿔줘"
          class="rounded-md bg-input font-sans text-foreground outline-none resize-none flex-1 text-xxs min-h-7 max-h-32 overflow-y-auto py-1.5 px-2 focus-ring"
        />
        <Button size="icon" variant="ghost" onClick={handleSend} aria-label="보내기">
          <Send />
        </Button>
      </div>
    </div>
  );
}
