import { A, Navigate, Route, Router, useNavigate, useParams } from "@solidjs/router";
import { createMemo, createSignal, Show, type JSX } from "solid-js";
import { Button } from "@/components/ui/button";
import { CenteredContainer } from "@/components/ui/container";
import { App } from "./app";
import { CanvasProvider } from "./context/canvas";
import { ChatProvider } from "./context/chat";
import { ScenesProvider, useScenes } from "./context/scenes";
import { UIProvider } from "./context/ui";

function Providers(props: { children?: JSX.Element }) {
  return (
    <ScenesProvider>
      <ChatProvider>
        <UIProvider>
          <CanvasProvider>
            {props.children}
          </CanvasProvider>
        </UIProvider>
      </ChatProvider>
    </ScenesProvider>
  );
}

/**
 * Nothing to show, and — since the sidebar and the agent chat only mount on a
 * scene route — nothing to click either. So the empty state carries the one
 * action that gets out of it.
 */
function NoProjects() {
  const navigate = useNavigate();
  const [creating, setCreating] = createSignal(false);

  const createProject = async () => {
    setCreating(true);
    try {
      const res = await fetch("/__scenes/project", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "New project" }),
      });
      const { project, scene } = (await res.json()) as { project: string; scene: string };
      navigate(`/${project}/${scene}`);
    } finally {
      setCreating(false);
    }
  };

  return (
    <CenteredContainer>
      <div class="flex flex-col items-center gap-3 text-center">
        <span class="text-foreground">아직 애니메이션이 하나도 없어요.</span>
        <span>새 프로젝트를 만들면 에이전트에게 요청할 수 있어요.</span>
        <Button onClick={createProject} disabled={creating()}>
          {creating() ? "만드는 중…" : "새 프로젝트 만들기"}
        </Button>
      </div>
    </CenteredContainer>
  );
}

function RedirectToDefault() {
  const { defaultScene, ready } = useScenes();
  return (
    <Show when={ready()} fallback={<CenteredContainer>불러오는 중…</CenteredContainer>}>
      <Show when={defaultScene()} fallback={<NoProjects />}>
        {(target) => <Navigate href={`/${target().project.slug}/${target().scene.slug}`} />}
      </Show>
    </Show>
  );
}

function NotFound() {
  return (
    <CenteredContainer>
      <div class="flex flex-col items-center gap-2">
        <span>찾을 수 없는 프로젝트예요.</span>
        <A href="/" class="text-foreground underline">
          목록으로 돌아가기
        </A>
      </div>
    </CenteredContainer>
  );
}

function SceneRoute() {
  const params = useParams();
  const { findScene, ready } = useScenes();

  const isSceneAvailable = createMemo(() => {
    return params.project && params.scene && findScene(params.project, params.scene);
  });

  return (
    <Show when={ready()} fallback={<CenteredContainer>불러오는 중…</CenteredContainer>}>
      <Show when={isSceneAvailable()} fallback={<NotFound />}>
        <App />
      </Show>
    </Show>
  );
}

export function Root() {
  return (
    <Router root={Providers}>
      <Route path="/" component={RedirectToDefault} />
      <Route path="/:project/:scene" component={SceneRoute} />
      <Route path="*" component={NotFound} />
    </Router>
  );
}
