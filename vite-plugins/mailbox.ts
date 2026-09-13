import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import type { Plugin, ViteDevServer } from "vite";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { ChatAttachment, ChatAuthFailure, ChatEffort, ChatMessage, ChatModel, ChatProgress, ChatSettings } from "../src/types/common";
import { resolveWorkspace } from "./workspace";
import { isSignedOut, resolveClaudePath } from "./claude-cli";

// Ceiling for one `claude -p` turn — covers reading references, editing a
// scene, and running the two validation scripts. Killed past this so a stuck
// invocation can't wedge the queue forever.
const WORKER_TIMEOUT_MS = 15 * 60 * 1000;

const FALLBACK_ERROR_TEXT = "요청을 처리하는 중에 문제가 생겼어요. 잠시 후 다시 말씀해 주세요.";

/**
 * A session can expire while the app sits open for days. The agent then fails
 * every turn with nothing the user can act on, so say what happened and offer
 * the way back — which differs by host, hence the two texts.
 */
const SIGNED_OUT_TEXT_APP =
  "Claude 로그인이 풀렸어요. 아래 '다시 로그인'을 누르면 로그인 창이 열려요. " +
  "로그인한 뒤 '다시 보내기'를 누르면 방금 요청을 그대로 이어서 처리할게요.";

const SIGNED_OUT_TEXT_DEV =
  "Claude 로그인이 풀렸어요. 터미널에서 `claude`를 한 번 실행해 로그인한 뒤 " +
  "'다시 보내기'를 눌러 주세요.";

const CLAUDE_MISSING_TEXT =
  "이 컴퓨터에 Claude Code가 아직 설치되어 있지 않아서 요청을 처리할 수 없어요. " +
  "https://claude.com/download 에서 설치한 뒤 다시 말씀해 주세요.";

// Attached SVGs are text and small by nature; this is generous headroom
// against an accidentally-huge or non-SVG file, not a real-world SVG size.
const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;

// Model settings a turn may be sent with. Validated against these lists rather
// than passed through: the request body reaches `claude`'s argv, so anything
// not on them is a value this UI cannot produce and is not worth trusting.
const MODELS: ChatModel[] = ["haiku", "sonnet", "opus"];
const EFFORTS: ChatEffort[] = ["low", "medium", "high", "max"];
const DEFAULT_SETTINGS: ChatSettings = { model: "sonnet", effort: "medium" };

/**
 * Reply shape for the chat panel, which is a 380px column — not a terminal.
 * Without this the agent answers at the length it would in a terminal session
 * and a greeting alone fills the whole panel.
 */
const CHAT_STYLE_PROMPT = [
  "너는 지금 Lottie Studio 화면 안의 좁은 채팅 패널(380px)로 답하고 있다.",
  "답은 3~4문장 안으로 끝내고, 목록을 쓰면 항목 3개까지만 쓴다.",
  "마크다운은 **굵게**, 목록, `코드` 정도만 쓰고 표나 제목은 쓰지 않는다.",
  "무엇을 했는지 화면에 보이는 결과로 말하고, 검사 로그나 JSON을 붙여넣지 않는다.",
].join(" ");

// How often progress is pushed to the browser while a turn runs. The agent
// emits events far faster than anyone can read them.
const PROGRESS_THROTTLE_MS = 400;

interface Thread {
  sessionId: string | null;
  messages: ChatMessage[];
}

interface QueueItem {
  project: string;
  placeholderId: string;
  userText: string;
  /** Path to the saved attachment, relative to the project root (for the prompt). */
  attachmentPath?: string;
  attachmentName?: string;
  /**
   * Carried on the item rather than read when the turn starts: the user can
   * change the setting while this message waits behind another project's turn,
   * and a message must run with the setting it was sent under.
   */
  settings: ChatSettings;
}

/** "../foo/bar.svg" -> "bar.svg"; strips anything unsafe for a filesystem name. */
function sanitizeFilename(name: string): string {
  const base = path.basename(name).replace(/[^a-zA-Z0-9._-]+/g, "-");
  return base || "upload.svg";
}

/**
 * Lightweight, regex-based SVG sanitizer. This file lands under `public/` and
 * is served as a static asset (and read back by the agent), so strip the
 * obvious script-injection vectors before it ever touches disk: `<script>`
 * elements, `on*` event handler attributes, and `javascript:` URIs. Not a
 * substitute for a real sanitizer, but this is a local single-user dev tool,
 * not content served to third parties.
 */
function sanitizeSvg(content: string): string {
  return content
    .replace(/<script[\s\S]*?<\/script\s*>/gi, "")
    .replace(/\son\w+\s*=\s*"[^"]*"/gi, "")
    .replace(/\son\w+\s*=\s*'[^']*'/gi, "")
    .replace(/(href|xlink:href)\s*=\s*(["'])\s*javascript:[^"']*\2/gi, "");
}

/**
 * One line of `--output-format stream-json`, narrowed to the fields used here.
 * The stream also carries token counts, per-tool results and partial deltas;
 * none of that is worth surfacing in a chat panel.
 */
interface StreamEvent {
  type: string;
  subtype?: string;
  session_id?: string;
  message?: { content?: unknown[] };
  result?: string;
  is_error?: boolean;
  duration_ms?: number;
}

interface ContentBlock {
  type: string;
  text?: string;
  name?: string;
  input?: Record<string, unknown>;
}

/** Only what a validated request body may contain. */
function readSettings(body: Record<string, unknown>): ChatSettings {
  const raw = body.settings && typeof body.settings === "object" ? (body.settings as Record<string, unknown>) : {};
  const model = MODELS.find((m) => m === raw.model) ?? DEFAULT_SETTINGS.model;
  const effort = EFFORTS.find((e) => e === raw.effort) ?? DEFAULT_SETTINGS.effort;
  return { model, effort };
}

/** Last non-empty line of the agent's own narration — its most recent thought. */
function lastLine(text: string): string | undefined {
  const lines = text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  return lines[lines.length - 1];
}

/** Trim a path down to what is recognisable in a narrow panel. */
function shortPath(value: unknown): string | undefined {
  if (typeof value !== "string" || !value) return undefined;
  const parts = value.split("/").filter(Boolean);
  return parts.slice(-2).join("/");
}

/**
 * A tool call, said the way a designer would describe it. The point of the
 * progress line is to answer "is it still doing something sensible?", so the
 * mapping stays coarse: the file being touched matters, the tool's name
 * does not.
 */
function describeTool(name: string, input: Record<string, unknown> = {}): { step: string; detail?: string } {
  const file = shortPath(input.file_path ?? input.path ?? input.notebook_path);
  switch (name) {
    case "Read":
      return { step: "참고 자료를 읽는 중", detail: file };
    case "Glob":
    case "Grep":
      return { step: "파일을 찾아보는 중" };
    case "Write":
      return { step: "씬 파일을 만드는 중", detail: file };
    case "Edit":
    case "NotebookEdit":
      return { step: "씬 파일을 고치는 중", detail: file };
    case "TodoWrite":
      return { step: "할 일을 정리하는 중" };
    case "Task":
      return { step: "따로 살펴보는 중" };
    case "WebFetch":
    case "WebSearch":
      return { step: "자료를 찾아보는 중" };
    case "Bash": {
      const command = typeof input.command === "string" ? input.command : "";
      if (/check-lottie|check:lottie/.test(command)) return { step: "화면에서 깨지는 곳이 없는지 검사하는 중" };
      if (/check-motion|check:motion/.test(command)) return { step: "움직임이 매끄러운지 검사하는 중" };
      if (/^\s*(ls|cat|head|tail|find|grep|sed|node -e)\b/.test(command)) return { step: "파일을 살펴보는 중" };
      // Anything else is some one-off command; "검사 도구" would be a guess.
      return { step: "필요한 걸 확인하는 중" };
    }
    default:
      if (name.startsWith("mcp__claude-in-chrome__")) return { step: "브라우저에서 직접 확인하는 중" };
      return { step: "작업하는 중" };
  }
}

function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    let data = "";
    req.on("data", (chunk) => (data += chunk));
    req.on("end", () => {
      try {
        resolve(JSON.parse(data || "{}"));
      } catch {
        resolve({});
      }
    });
  });
}

/**
 * Serves a chat mailbox at `/__chat` (dev only), one conversation per project
 * so switching projects switches Claude sessions too: the browser POSTs
 * prompts to `/__chat/send`, a headless `claude -p` process (spawned per
 * message, one at a time across all projects) picks them up and edits
 * `public/projects/<project>/...` exactly as it would from an interactive
 * terminal session, and replies get pushed back to the browser over Vite's
 * HMR socket as `chat:update` — with `chat:progress` carrying what the agent
 * is doing while a turn is still running.
 */
export interface MailboxOptions {
  /**
   * Opens the host's sign-in flow. The packaged app passes one (it owns the
   * setup window); a dev server passes none, and its users are told to sign in
   * from a terminal instead.
   */
  signIn?: () => void;
}

export function mailboxPlugin(options: MailboxOptions = {}): Plugin {
  const canSignIn = typeof options.signIn === "function";
  let projectRoot = "";
  let mailboxDir = "";
  let projectsDir = "";

  const queue: QueueItem[] = [];
  let busy = false;
  let activeItem: QueueItem | null = null;
  let activeChild: ChildProcess | null = null;
  // Placeholder ids the user cancelled — consulted both when a queued item
  // is about to start (skip it) and when the active one finishes (report it
  // as cancelled rather than as a generic failure).
  const cancelledIds = new Set<string>();

  /** `.mailbox/<project>/thread.json`, resolved and containment-checked. */
  function threadPath(project: string): string | null {
    const dir = path.resolve(mailboxDir, project);
    if (!dir.startsWith(mailboxDir + path.sep)) return null;
    return path.join(dir, "thread.json");
  }

  /**
   * Prompt fields for an attachment that is already saved under the project —
   * used when a request is queued a second time, so a retry keeps the file the
   * user originally dropped without uploading it again.
   */
  function attachmentOf(project: string, attachment?: ChatAttachment): Pick<QueueItem, "attachmentPath" | "attachmentName"> {
    if (!attachment) return {};
    const file = path.resolve(projectsDir, attachment.url.replace(/^\/projects\//, ""));
    if (!file.startsWith(path.resolve(projectsDir, project) + path.sep) || !fs.existsSync(file)) return {};
    return {
      attachmentPath: path.relative(projectRoot, file).split(path.sep).join("/"),
      attachmentName: attachment.name,
    };
  }

  function readThread(project: string): Thread {
    const file = threadPath(project);
    if (!file) return { sessionId: null, messages: [] };
    try {
      return JSON.parse(fs.readFileSync(file, "utf8")) as Thread;
    } catch {
      return { sessionId: null, messages: [] };
    }
  }

  function writeThread(project: string, thread: Thread): void {
    const file = threadPath(project);
    if (!file) return;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(thread, null, 2));
  }

  function broadcast(server: ViteDevServer, project: string): void {
    server.ws.send({
      type: "custom",
      event: "chat:update",
      data: { project, messages: readThread(project).messages },
    });
  }

  // Progress state for the single in-flight turn (the queue runs one at a
  // time). Pushed on its own event and never written to thread.json — one turn
  // produces hundreds of these and only the final reply is worth keeping.
  let latestProgress: ChatProgress | null = null;
  let progressTimer: ReturnType<typeof setTimeout> | null = null;
  let lastProgressAt = 0;

  function sendProgress(server: ViteDevServer, progress: ChatProgress): void {
    lastProgressAt = Date.now();
    server.ws.send({ type: "custom", event: "chat:progress", data: progress });
  }

  /**
   * Push the newest progress line, at most one every PROGRESS_THROTTLE_MS.
   * Intermediate lines are dropped rather than queued: what the agent is doing
   * *now* is the only interesting one.
   */
  function publishProgress(server: ViteDevServer, progress: ChatProgress): void {
    latestProgress = progress;
    if (progressTimer) return;
    const wait = PROGRESS_THROTTLE_MS - (Date.now() - lastProgressAt);
    if (wait <= 0) {
      sendProgress(server, progress);
      return;
    }
    progressTimer = setTimeout(() => {
      progressTimer = null;
      if (latestProgress) sendProgress(server, latestProgress);
    }, wait);
  }

  /** An empty `step` tells the client this turn has no progress any more. */
  function clearProgress(server: ViteDevServer, item: QueueItem): void {
    if (progressTimer) {
      clearTimeout(progressTimer);
      progressTimer = null;
    }
    latestProgress = null;
    sendProgress(server, { project: item.project, messageId: item.placeholderId, step: "", startedAt: 0 });
  }

  function processNext(server: ViteDevServer): void {
    if (busy) return;
    while (queue.length > 0 && cancelledIds.has(queue[0].placeholderId)) {
      cancelledIds.delete(queue.shift()!.placeholderId);
    }
    if (queue.length === 0) return;

    busy = true;
    const item = queue.shift()!;
    activeItem = item;

    // Only now — actually starting a `claude -p` process — does the
    // placeholder become "processing"; until this point it was "pending"
    // (queued behind another project's turn).
    const thread = readThread(item.project);
    const message = thread.messages.find((m) => m.id === item.placeholderId);
    if (message) message.status = "processing";
    writeThread(item.project, thread);
    broadcast(server, item.project);

    runClaude(server, item);
  }

  /** Write a final reply into the placeholder and let the queue move on. */
  function settleWith(server: ViteDevServer, item: QueueItem, text: string, isError: boolean): void {
    clearProgress(server, item);
    const thread = readThread(item.project);
    const message = thread.messages.find((m) => m.id === item.placeholderId);
    if (message) {
      message.text = text;
      message.status = isError ? "error" : "done";
    }
    writeThread(item.project, thread);
    broadcast(server, item.project);
    activeItem = null;
    busy = false;
    processNext(server);
  }

  function runClaude(server: ViteDevServer, item: QueueItem, forceNewSession = false): void {
    // Resolved up front rather than relying on PATH: a GUI-launched server has
    // none of the per-user install locations on it.
    const claudePath = resolveClaudePath();
    if (!claudePath) {
      console.error("[mailbox] claude executable not found — is Claude Code installed?");
      settleWith(server, item, CLAUDE_MISSING_TEXT, true);
      return;
    }

    const sessionId = forceNewSession ? null : readThread(item.project).sessionId;
    // The project is named explicitly rather than left to /__context alone:
    // if the queue is backed up, the browser's live state may have moved on
    // to a different project by the time this turn actually runs.
    let prompt = `현재 대상 프로젝트는 "${item.project}"다. `;
    if (item.attachmentPath) {
      prompt += `사용자가 SVG 파일을 첨부했다 (경로: ${item.attachmentPath}, 원본 파일명: ${item.attachmentName}). 이 파일을 읽어서 참고해라. `;
    }
    prompt += item.userText || "첨부한 SVG를 기반으로 애니메이션을 만들어줘.";

    // `stream-json` rather than `json`: the panel needs to say what the agent
    // is doing while it does it, and a single end-of-turn blob cannot. It also
    // requires --verbose, which only affects what the stream carries.
    const args = [
      "-p",
      prompt,
      "--output-format",
      "stream-json",
      "--verbose",
      "--append-system-prompt",
      CHAT_STYLE_PROMPT,
      "--model",
      item.settings.model,
      "--dangerously-skip-permissions",
    ];
    // Haiku has no effort levels; passing one would fail the invocation.
    if (item.settings.model !== "haiku") args.push("--effort", item.settings.effort);
    if (sessionId) args.push("--resume", sessionId);

    const startedAt = Date.now();
    let stderr = "";
    let pending = ""; // partial trailing line of the NDJSON stream
    let settled = false;
    let result: StreamEvent | null = null;
    let nextSessionId = sessionId;

    const report = (step: string, detail?: string) =>
      publishProgress(server, { project: item.project, messageId: item.placeholderId, step, detail, startedAt });

    report("시작하는 중");

    const handleEvent = (event: StreamEvent): void => {
      if (typeof event.session_id === "string") nextSessionId = event.session_id;

      if (event.type === "system" && event.subtype === "init") {
        report("준비하는 중");
        return;
      }
      if (event.type === "result") {
        result = event;
        return;
      }
      if (event.type !== "assistant") return;

      for (const raw of event.message?.content ?? []) {
        const block = raw as ContentBlock;
        if (block.type === "text" && block.text) {
          // The agent narrating its own next step is the best label there is —
          // better than any mapping of tool names.
          const line = lastLine(block.text);
          if (line) report("작업하는 중", line);
        } else if (block.type === "tool_use" && block.name) {
          const { step, detail } = describeTool(block.name, block.input);
          report(step, detail);
        }
      }
    };

    const consume = (chunk: string): void => {
      pending += chunk;
      const lines = pending.split("\n");
      pending = lines.pop() ?? "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          handleEvent(JSON.parse(trimmed) as StreamEvent);
        } catch {
          // A non-JSON line is startup noise, not something to fail a turn over.
        }
      }
    };

    const child = spawn(claudePath, args, { cwd: projectRoot, stdio: ["ignore", "pipe", "pipe"] });
    activeChild = child;

    const timer = setTimeout(() => child.kill(), WORKER_TIMEOUT_MS);
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => consume(chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));

    const finish = () => {
      if (settled) return;
      if (pending.trim()) consume("\n");

      // A stale/unknown session id (e.g. expired on Anthropic's side) makes
      // `claude -p --resume` fail before it ever produces a result event —
      // retry once as a brand-new session instead of surfacing an error the
      // user has no way to act on. Skipped if the user cancelled in the
      // meantime.
      if (
        !forceNewSession &&
        sessionId &&
        !result &&
        !cancelledIds.has(item.placeholderId) &&
        /no conversation found/i.test(stderr)
      ) {
        settled = true;
        clearTimeout(timer);
        activeChild = null;
        runClaude(server, item, true);
        return;
      }

      settled = true;
      clearTimeout(timer);
      activeChild = null;
      activeItem = null;
      clearProgress(server, item);

      if (cancelledIds.delete(item.placeholderId)) {
        const thread = readThread(item.project);
        const message = thread.messages.find((m) => m.id === item.placeholderId);
        if (message) {
          message.status = "cancelled";
          message.text = "";
        }
        writeThread(item.project, thread);
        broadcast(server, item.project);
        busy = false;
        processNext(server);
        return;
      }

      let replyText = FALLBACK_ERROR_TEXT;
      let isError = true;
      let saysSignedOut = false;

      // `claude -p` can exit non-zero while still having streamed a valid
      // result event (e.g. "not logged in") — always go by the event, never
      // by the exit code.
      const final: StreamEvent | null = result;
      if (final && typeof final.result === "string" && final.result.length > 0) {
        isError = Boolean(final.is_error);
        if (!isError) {
          replyText = final.result;
        } else if (/not logged in/i.test(final.result)) {
          saysSignedOut = true;
        } else {
          console.error(`[mailbox] claude reported an error: ${final.result}`);
        }
      } else {
        console.error(`[mailbox] claude invocation produced no usable result event.\nstderr:\n${stderr}`);
      }

      /** Write the reply into the placeholder and let the queue move on. */
      const commit = (auth: ChatAuthFailure | null): void => {
        const thread = readThread(item.project);
        thread.sessionId = nextSessionId;
        const message = thread.messages.find((m) => m.id === item.placeholderId);
        if (message) {
          message.text = auth ? (auth.canSignIn ? SIGNED_OUT_TEXT_APP : SIGNED_OUT_TEXT_DEV) : replyText;
          message.status = isError ? "error" : "done";
          message.settings = item.settings;
          if (auth) message.auth = auth;
          // Recorded on success only: a failed turn's duration would poison the
          // "usually takes about this long" estimate the panel shows.
          if (!isError) message.durationMs = final?.duration_ms ?? Date.now() - startedAt;
        }
        writeThread(item.project, thread);
        broadcast(server, item.project);

        busy = false;
        processNext(server);
      };

      if (!isError) {
        commit(null);
        return;
      }

      // Every failure asks the CLI whether an account is still signed in,
      // rather than matching on the wording of the error: an expired session
      // is the one failure the user can actually fix, and it must not be
      // missed because the message was phrased differently. The queue stays
      // busy for the length of that check, which is why it is not blocking.
      void isSignedOut().then((signedOut) => commit(signedOut || saysSignedOut ? { canSignIn } : null));
    };

    child.on("close", () => finish());
    child.on("error", (err) => {
      console.error("[mailbox] failed to spawn claude:", err);
      finish();
    });
  }

  return {
    name: "mailbox",

    configResolved(config) {
      // The agent's cwd is the workspace, not the Vite root: in a packaged app
      // the bundle is read-only, and claude needs somewhere it can actually
      // write. In repo mode the two are the same directory.
      const ws = resolveWorkspace(config.root);
      projectRoot = ws.root;
      mailboxDir = ws.mailboxDir;
      projectsDir = ws.projectsDir;
    },

    configureServer(server) {
      const json = (res: ServerResponse, status: number, body: unknown) => {
        res.statusCode = status;
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify(body));
      };

      fs.mkdirSync(mailboxDir, { recursive: true });

      // A message stuck "pending"/"processing" means a previous dev server
      // run was killed mid-turn (or while queued) — the in-memory queue is
      // gone on restart, so surface that instead of leaving it stuck.
      for (const project of fs.readdirSync(mailboxDir, { withFileTypes: true })) {
        if (!project.isDirectory()) continue;
        const thread = readThread(project.name);
        let recovered = false;
        for (const message of thread.messages) {
          if (message.status === "pending" || message.status === "processing") {
            message.status = "error";
            message.text = "이전 요청이 처리되는 중에 서버가 멈췄어요. 다시 말씀해 주세요.";
            recovered = true;
          }
        }
        if (recovered) writeThread(project.name, thread);
      }

      process.on("exit", () => activeChild?.kill());

      // Send a prompt (POST, body: { project, text }). Registered before the
      // bare `/__chat` route below since connect matches by path prefix.
      server.middlewares.use("/__chat/send", async (req, res) => {
        if (req.method !== "POST") return json(res, 405, { error: "method not allowed" });
        const body = await readJsonBody(req);
        const project = typeof body.project === "string" ? body.project : "";
        const text = typeof body.text === "string" ? body.text.trim() : "";
        if (!project || !threadPath(project)) return json(res, 400, { error: "missing or invalid project" });

        const rawAttachment =
          body.attachment && typeof body.attachment === "object"
            ? (body.attachment as Record<string, unknown>)
            : null;
        const attachmentName = typeof rawAttachment?.name === "string" ? rawAttachment.name : "";
        const attachmentContent = typeof rawAttachment?.content === "string" ? rawAttachment.content : "";
        const hasAttachment = Boolean(attachmentName && attachmentContent);

        if (!text && !hasAttachment) return json(res, 400, { error: "missing text" });
        if (hasAttachment) {
          if (!/\.svg$/i.test(attachmentName)) {
            return json(res, 400, { error: "only .svg attachments are supported" });
          }
          if (Buffer.byteLength(attachmentContent, "utf8") > MAX_ATTACHMENT_BYTES) {
            return json(res, 400, { error: "attachment too large" });
          }
        }

        let attachment: { name: string; url: string } | undefined;
        let attachmentPath: string | undefined;
        if (hasAttachment) {
          const projectDir = path.resolve(projectsDir, project);
          if (!projectDir.startsWith(projectsDir + path.sep) || !fs.existsSync(projectDir)) {
            return json(res, 404, { error: "project not found" });
          }
          const uploadsDir = path.join(projectDir, "uploads");
          fs.mkdirSync(uploadsDir, { recursive: true });
          const filename = `${Date.now()}-${sanitizeFilename(attachmentName)}`;
          const filePath = path.join(uploadsDir, filename);
          fs.writeFileSync(filePath, sanitizeSvg(attachmentContent));
          attachment = { name: attachmentName, url: `/projects/${project}/uploads/${filename}` };
          attachmentPath = path.relative(projectRoot, filePath).split(path.sep).join("/");
        }

        const now = new Date().toISOString();
        const userMessage: ChatMessage = {
          id: crypto.randomUUID(),
          role: "user",
          text,
          status: "done",
          createdAt: now,
          attachment,
        };
        const placeholder: ChatMessage = {
          id: crypto.randomUUID(),
          role: "assistant",
          text: "",
          status: "pending",
          createdAt: now,
        };

        const thread = readThread(project);
        thread.messages.push(userMessage, placeholder);
        writeThread(project, thread);
        broadcast(server, project);

        queue.push({
          project,
          placeholderId: placeholder.id,
          userText: text,
          attachmentPath,
          attachmentName: attachment?.name,
          settings: readSettings(body),
        });
        processNext(server);

        json(res, 201, { ok: true });
      });

      // Cancel an in-flight or still-queued turn (POST, body: { project, messageId }).
      server.middlewares.use("/__chat/cancel", async (req, res) => {
        if (req.method !== "POST") return json(res, 405, { error: "method not allowed" });
        const body = await readJsonBody(req);
        const project = typeof body.project === "string" ? body.project : "";
        const messageId = typeof body.messageId === "string" ? body.messageId : "";
        if (!project || !threadPath(project) || !messageId) {
          return json(res, 400, { error: "missing or invalid project/messageId" });
        }

        if (activeItem && activeItem.project === project && activeItem.placeholderId === messageId) {
          // Actually running: mark it, then kill — `finish()` sees the mark
          // and reports "cancelled" instead of the generic failure text.
          cancelledIds.add(messageId);
          activeChild?.kill();
        } else {
          const index = queue.findIndex((q) => q.project === project && q.placeholderId === messageId);
          if (index !== -1) queue.splice(index, 1);
          const thread = readThread(project);
          const message = thread.messages.find((m) => m.id === messageId);
          if (message && (message.status === "pending" || message.status === "processing")) {
            message.status = "cancelled";
            message.text = "";
            writeThread(project, thread);
            broadcast(server, project);
          }
        }

        json(res, 200, { ok: true });
      });

      // Start a fresh conversation for a project (POST, body: { project }):
      // drops its queued/in-flight turns, clears history and the session id.
      server.middlewares.use("/__chat/reset", async (req, res) => {
        if (req.method !== "POST") return json(res, 405, { error: "method not allowed" });
        const body = await readJsonBody(req);
        const project = typeof body.project === "string" ? body.project : "";
        if (!project || !threadPath(project)) return json(res, 400, { error: "missing or invalid project" });

        for (let i = queue.length - 1; i >= 0; i--) {
          if (queue[i].project === project) queue.splice(i, 1);
        }
        if (activeItem && activeItem.project === project) {
          cancelledIds.add(activeItem.placeholderId);
          activeChild?.kill();
        }

        writeThread(project, { sessionId: null, messages: [] });
        broadcast(server, project);

        json(res, 200, { ok: true });
      });

      // Send a failed request again, unchanged (POST, body: { project, messageId }).
      // Rebuilt from the thread rather than from a copy held in memory, so it
      // still works after a restart — an expired session is often noticed the
      // next day, with the app freshly opened.
      server.middlewares.use("/__chat/retry", async (req, res) => {
        if (req.method !== "POST") return json(res, 405, { error: "method not allowed" });
        const body = await readJsonBody(req);
        const project = typeof body.project === "string" ? body.project : "";
        const messageId = typeof body.messageId === "string" ? body.messageId : "";
        if (!project || !threadPath(project) || !messageId) {
          return json(res, 400, { error: "missing or invalid project/messageId" });
        }

        const thread = readThread(project);
        const index = thread.messages.findIndex((m) => m.id === messageId);
        const placeholder = index === -1 ? undefined : thread.messages[index];
        const request = index > 0 ? thread.messages[index - 1] : undefined;
        if (!placeholder || placeholder.role !== "assistant" || request?.role !== "user") {
          return json(res, 404, { error: "nothing to retry" });
        }
        if (activeItem?.placeholderId === messageId || queue.some((q) => q.placeholderId === messageId)) {
          return json(res, 409, { error: "already queued" });
        }

        // The same placeholder is reused, so the thread does not grow a second
        // empty bubble every time a retry is needed.
        placeholder.status = "pending";
        placeholder.text = "";
        delete placeholder.auth;
        writeThread(project, thread);
        broadcast(server, project);

        queue.push({
          project,
          placeholderId: messageId,
          userText: request.text,
          ...attachmentOf(project, request.attachment),
          settings: placeholder.settings ?? DEFAULT_SETTINGS,
        });
        processNext(server);

        json(res, 200, { ok: true });
      });

      // Ask the host to open its sign-in flow (POST). Only the packaged app
      // has one; a dev server answers `{ ok: false }` and the panel says to
      // sign in from a terminal instead.
      server.middlewares.use("/__chat/signin", (req, res) => {
        if (req.method !== "POST") return json(res, 405, { error: "method not allowed" });
        if (!options.signIn) return json(res, 200, { ok: false });
        options.signIn();
        json(res, 200, { ok: true });
      });

      // Initial load for one project's thread: GET /__chat?project=<slug>.
      server.middlewares.use("/__chat", (req, res) => {
        const url = new URL(req.url ?? "", "http://localhost");
        const project = url.searchParams.get("project") ?? "";
        if (!project || !threadPath(project)) return json(res, 200, []);
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify(readThread(project).messages));
      });
    },
  };
}
