import type { PropsWithChildren } from 'react';
import { useApp } from '../store/app';
import { Sidebar } from './Sidebar';
import { Topbar } from './Topbar';
import { ToastStack } from './Toast';
import { ConfirmModal } from './ConfirmModal';
import { Onboarding } from './Onboarding';

/**
 * Primary frame. The <main> area is a bounded flex column. Routes that
 * want internal-only scroll (overview, progress) own their own scroll
 * regions; everything else uses the outer `overflow-y-auto` fallback so
 * tall content can still scroll.
 */
const NO_OUTER_SCROLL = new Set<string>(['overview', 'progress']);

export function Layout({ children }: PropsWithChildren) {
  const route = useApp((s) => s.route);
  const outerScroll = NO_OUTER_SCROLL.has(route.name) ? 'overflow-hidden' : 'overflow-y-auto';
  return (
    <div className="flex h-full overflow-hidden">
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0 h-full">
        <Topbar />
        <main
          key={`${route.name}`}
          className={`flex-1 min-h-0 ${outerScroll} px-10 py-8`}
        >
          <div className="mx-auto max-w-6xl h-full min-h-0 flex flex-col">
            {children}
          </div>
        </main>
      </div>
      <ToastStack />
      <ConfirmModal />
      <Onboarding />
    </div>
  );
}
