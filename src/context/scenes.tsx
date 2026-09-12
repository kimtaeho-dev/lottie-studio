import { createContext, createResource, useContext, type JSX } from "solid-js";
import type { ScenesTree, Project, Scene } from "@/types";
import { markLive, onServerEvent } from "@/lib/live";

// A studio backend (dev server, or the packaged app's own server) serves a live
// tree at /__scenes and pushes updates. Without one — the bundle deployed as
// plain static files — fall back to the scenes.json snapshot emitted at build.
const LIVE_SCENES_URL = "/__scenes";
const STATIC_SCENES_URL = "/scenes.json";

const ScenesContext = createContext<{
  projects: () => Project[];
  findProject: (slug: string) => Project | undefined;
  findScene: (projectSlug: string, sceneSlug: string) => Scene | undefined;
  defaultScene: () => { project: Project; scene: Scene } | undefined;
  ready: () => boolean;
}>();

async function loadScenes(): Promise<ScenesTree> {
  try {
    const res = await fetch(LIVE_SCENES_URL);
    if (res.ok) {
      markLive(true);
      return (await res.json()) as ScenesTree;
    }
  } catch {
    // no backend listening — fall through to the static snapshot
  }
  markLive(false);
  const res = await fetch(STATIC_SCENES_URL);
  if (!res.ok) throw new Error(`Failed to load scenes from ${STATIC_SCENES_URL} (HTTP ${res.status})`);
  return (await res.json()) as ScenesTree;
}

export function ScenesProvider(props: { children: JSX.Element }) {
  const [tree, { mutate }] = createResource(loadScenes);

  // Live-patch the tree when the dev plugin reports filesystem changes.
  onServerEvent<ScenesTree>("scenes:update", (next) => mutate(next));

  const projects = () => tree()?.projects ?? [];
  const findProject = (slug: string) => projects().find((p) => p.slug === slug);
  const findScene = (projectSlug: string, sceneSlug: string) =>
    findProject(projectSlug)?.scenes.find((s) => s.slug === sceneSlug);
  const defaultScene = () => {
    const project = projects()[0];
    const scene = project?.scenes[0];
    return project && scene ? { project, scene } : undefined;
  };
  const ready = () => !tree.loading && tree() != null;

  return (
    <ScenesContext.Provider value={{ projects, findProject, findScene, defaultScene, ready }}>
      {props.children}
    </ScenesContext.Provider>
  );
}

export function useScenes() {
  const context = useContext(ScenesContext);
  if (!context) {
    throw new Error("useScenes must be used within a ScenesProvider");
  }
  return context;
}
