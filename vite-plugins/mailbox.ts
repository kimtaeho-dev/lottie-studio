import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import type { Plugin, ViteDevServer } from "vite";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { ChatMessage } from "../src/types/common";

// Ceiling for one `claude -p` turn — covers reading references, editing a
// scene, and running the two validation scripts. Killed past this so a stuck
// invocation can't wedge the queue forever.
const WORKER_TIMEOUT_MS = 15 * 60 * 1000;

const FALLBACK_ERROR_TEXT = "요청을 처리하는 중에 문제가 생겼어요. 잠시 후 다시 말씀해 주세요.";

interface Thread {
  sessionId: string | null;
  messages: ChatMessage[];
}

interface QueueItem {
  project: string;
  placeholderId: string;
  userText: string;
}

interface ClaudeResult {
  result?: string;
  session_id?: string;
  is_error?: boolean;
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
 * HMR socket as `chat:update`.
 */
export function mailboxPlugin(): Plugin {
  let projectRoot = "";
  let mailboxDir = "";

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

  function runClaude(server: ViteDevServer, item: QueueItem, forceNewSession = false): void {
    const sessionId = forceNewSession ? null : readThread(item.project).sessionId;
    // The project is named explicitly rather than left to /__context alone:
    // if the queue is backed up, the browser's live state may have moved on
    // to a different project by the time this turn actually runs.
    const prompt = `현재 대상 프로젝트는 "${item.project}"다. ${item.userText}`;
    const args = ["-p", prompt, "--output-format", "json", "--dangerously-skip-permissions"];
    if (sessionId) args.push("--resume", sessionId);

    let stdout = "";
    let stderr = "";
    let settled = false;

    const child = spawn("claude", args, { cwd: projectRoot, stdio: ["ignore", "pipe", "pipe"] });
    activeChild = child;

    const timer = setTimeout(() => child.kill(), WORKER_TIMEOUT_MS);
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));

    const finish = () => {
      if (settled) return;

      // A stale/unknown session id (e.g. expired on Anthropic's side) makes
      // `claude -p --resume` fail before it ever produces JSON — retry once
      // as a brand-new session instead of surfacing an error the user has no
      // way to act on. Skipped if the user cancelled in the meantime.
      if (!forceNewSession && sessionId && !cancelledIds.has(item.placeholderId) && /no conversation found/i.test(stderr)) {
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
      let nextSessionId = sessionId;

      // `claude -p` can exit non-zero while still printing a valid JSON
      // result (e.g. "not logged in") — always try to parse stdout first,
      // regardless of the exit code, rather than only on a clean exit.
      let parsed: ClaudeResult | null = null;
      try {
        parsed = JSON.parse(stdout) as ClaudeResult;
      } catch {
        // not JSON — a crash, a kill, or a spawn failure; handled below.
      }

      if (parsed && typeof parsed.result === "string" && parsed.result.length > 0) {
        isError = Boolean(parsed.is_error);
        if (typeof parsed.session_id === "string") nextSessionId = parsed.session_id;
        if (!isError) {
          replyText = parsed.result;
        } else if (/not logged in/i.test(parsed.result)) {
          replyText = "claude CLI 로그인이 안 되어 있는 것 같아요. 터미널에서 `claude`를 한 번 실행해 로그인한 뒤 다시 말씀해 주세요.";
        } else {
          console.error(`[mailbox] claude reported an error: ${parsed.result}`);
        }
      } else {
        console.error(`[mailbox] claude invocation produced no usable output.\nstdout:\n${stdout}\nstderr:\n${stderr}`);
      }

      const thread = readThread(item.project);
      thread.sessionId = nextSessionId;
      const message = thread.messages.find((m) => m.id === item.placeholderId);
      if (message) {
        message.text = replyText;
        message.status = isError ? "error" : "done";
      }
      writeThread(item.project, thread);
      broadcast(server, item.project);

      busy = false;
      processNext(server);
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
      projectRoot = config.root;
      mailboxDir = path.resolve(config.root, ".mailbox");
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
        if (!text) return json(res, 400, { error: "missing text" });

        const now = new Date().toISOString();
        const userMessage: ChatMessage = {
          id: crypto.randomUUID(),
          role: "user",
          text,
          status: "done",
          createdAt: now,
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

        queue.push({ project, placeholderId: placeholder.id, userText: text });
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
