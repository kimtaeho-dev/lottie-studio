import { Show } from 'solid-js';
import { SidebarLeft } from '@/components/sidebar-left';
import { PlaybackControls } from '@/components/playback-controls';
import { ScenesContainer } from '@/components/scenes-container';
import { SidebarRight } from '@/components/sidebar-right';
import { ChatPanel } from '@/components/chat-panel';
import { useUI } from '@/context/ui';
import { isLive } from "@/lib/live";

export function App() {
  const { controlsExpanded } = useUI();

  return (
    <>
      <SidebarLeft />
      <div class="absolute inset-x-0 bottom-4 flex flex-col items-center gap-4 px-4">
        <PlaybackControls />
        <Show when={controlsExpanded()}>
          <ScenesContainer />
        </Show>
      </div>
      <div class="absolute right-4 top-4 bottom-4 flex flex-col gap-4">
        <SidebarRight />
        <Show when={isLive()}>
          <ChatPanel />
        </Show>
      </div>
    </>
  );
};
