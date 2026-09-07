import { createEffect, createSignal, For, Show } from "solid-js";
import { RotateCcw, Send, X } from "lucide-solid";
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
import { useChat } from "@/context/chat";

const MAX_TEXTAREA_HEIGHT = 128; // px — grows up to this, then scrolls internally

export function ChatPanel() {
  const { messages, sending, send, cancel, reset } = useChat();
  const [text, setText] = createSignal("");
  let listRef: HTMLDivElement | undefined;
  let textareaRef: HTMLTextAreaElement | undefined;

  const autoGrow = () => {
    if (!textareaRef) return;
    textareaRef.style.height = "auto";
    textareaRef.style.height = `${Math.min(textareaRef.scrollHeight, MAX_TEXTAREA_HEIGHT)}px`;
  };

  const handleSend = async () => {
    const value = text().trim();
    if (!value || sending()) return;
    setText("");
    autoGrow();
    await send(value);
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
    <div class="flex flex-col flex-1 min-h-0 w-[380px] rounded-2xl gap-0 bg-background border border-border">
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

      <div class="flex items-end gap-1.5 px-3 py-2 border-t border-border shrink-0">
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
