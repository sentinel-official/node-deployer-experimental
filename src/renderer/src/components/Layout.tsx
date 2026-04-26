import type { PropsWithChildren } from 'react';
import { useApp } from '../store/app';
import { Sidebar } from './Sidebar';
import { Topbar } from './Topbar';
import { ToastStack } from './Toast';
import { ConfirmModal } from './ConfirmModal';
import { Onboarding } from './Onboarding';
import { MIcon } from './MIcon';

const NO_OUTER_SCROLL = new Set<string>([
  'overview',
  'progress',
  'wallet',
  'deploy-ssh',
  'deploy-local',
  'node-details',
  'settings',
  'manage-docker',
  'help',
]);

export function Layout({ children }: PropsWithChildren) {
  const route = useApp((s) => s.route);
  const outerScroll = NO_OUTER_SCROLL.has(route.name) ? 'overflow-hidden' : 'overflow-y-auto';
  return (
    <div className="flex h-full overflow-hidden">
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0 h-full">
        <Topbar />
        <main
          key={route.name}
          className={`flex-1 min-h-0 ${outerScroll} page-transition`}
          style={{ padding: '16px 22px' }}
        >
          <div className="mx-auto max-w-[1280px] h-full min-h-0 flex flex-col">{children}</div>
        </main>
      </div>
      <ToastStack />
      <ConfirmModal />
      <Onboarding />
    </div>
  );
}
