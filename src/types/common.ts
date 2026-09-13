export interface ControlMeta {
  sid: string;
  label?: string;
  min?: number;
  max?: number;
  step?: number;
  /** Extra slot ids this control also writes to (hidden from the panel). See player-contract.md. */
  targetSids?: string[];
}

export interface Scene {
  /** Folder name, kept verbatim (e.g. "scene-1"). Used as the URL segment. */
  slug: string;
  /** Human label derived from the slug (e.g. "Scene 1"). */
  label: string;
  /** Sort order parsed from a trailing "-NN" in the slug; Infinity when absent. */
  order: number;
  /** Public URL of the scene's lottie.json. */
  lottie: string;
  /** Public URL of the scene's controls.json, when present. */
  controls?: string;
  /** Public URLs of image assets in the scene folder. */
  images: string[];
  /** Public URLs of font files (.ttf/.otf/.ttc) in the scene folder. */
  fonts: string[];
}

export interface Project {
  slug: string;
  label: string;
  scenes: Scene[];
}

export interface ScenesTree {
  projects: Project[];
}

export type AnimationSlot =
  | { id: string; type: "scalar"; value: number }
  | { id: string; type: "color"; value: [number, number, number, number] }
  | { id: string; type: "vec2"; value: [number, number] }
  | { id: string; type: "text"; value: string };

/** A file the user attached to a chat message (e.g. a dropped SVG). */
export interface ChatAttachment {
  /** Original filename as picked/dropped by the user. */
  name: string;
  /** Public URL of the saved copy, e.g. "/projects/<project>/uploads/<file>.svg". */
  url: string;
}

/** Which Claude model a turn runs on. Mirrors the CLI's `--model` aliases. */
export type ChatModel = "haiku" | "sonnet" | "opus";

/** How much the model deliberates. Mirrors the CLI's `--effort` levels. */
export type ChatEffort = "low" | "medium" | "high" | "max";

/** The model settings a single turn was sent with. */
export interface ChatSettings {
  model: ChatModel;
  effort: ChatEffort;
}

/**
 * Why a turn failed, when the reason is that the agent has no signed-in
 * account. Present only on a failed assistant message.
 */
export interface ChatAuthFailure {
  /** True when the host can open a sign-in window itself — the packaged app can, a dev server cannot. */
  canSignIn: boolean;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  status: "pending" | "processing" | "done" | "error" | "cancelled";
  createdAt: string;
  attachment?: ChatAttachment;
  /** Assistant messages only: the settings this turn actually ran with. */
  settings?: ChatSettings;
  /** Assistant messages only: wall-clock time of a finished turn, in ms. */
  durationMs?: number;
  /** Set when this turn failed because the agent is signed out; the request can be sent again. */
  auth?: ChatAuthFailure;
}

/**
 * Live status of an in-flight turn, pushed as `chat:progress` while the agent
 * works. Deliberately not persisted to `thread.json` — a single turn produces
 * hundreds of these and only the final reply is worth keeping.
 */
export interface ChatProgress {
  project: string;
  /** The placeholder message this progress belongs to. */
  messageId: string;
  /** Short Korean label for what the agent is doing right now. */
  step: string;
  /** Optional second line: a filename, a plan step, the agent's own words. */
  detail?: string;
  /** Epoch ms the turn started, so the client can run its own timer. */
  startedAt: number;
}
