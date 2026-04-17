import { useState } from 'react';
import { useApp } from '../store/app';
import { MIcon } from './MIcon';

/**
 * First-run onboarding overlay. 3 slides. Can be dismissed at any point.
 * Persisted via `settings.seenOnboarding`.
 */
export function Onboarding() {
  const { settings, saveSettings } = useApp();
  const [slide, setSlide] = useState(0);

  if (!settings || settings.seenOnboarding) return null;

  const done = async () => {
    await saveSettings({ seenOnboarding: true });
  };

  const slides = [
    {
      icon: 'vpn_key',
      title: 'Welcome to Sentinel dVPN',
      body: 'Deploy and operate decentralized VPN nodes on the Sentinel network. Earn $P2P for the bandwidth you serve — all settlement happens on chain.',
    },
    {
      icon: 'dns',
      title: 'Run a node, locally or in the cloud',
      body: 'We spin up sentinel-dvpnx in a Docker container, either on this machine or on any SSH-reachable VPS. We handle keygen, config, and restart policies.',
    },
    {
      icon: 'account_balance_wallet',
      title: 'One wallet, many nodes',
      body: 'Your in-app wallet holds $P2P for gas and collected rewards. Each node owns its own operator key — withdraw rewards to your app wallet in one click.',
    },
  ] as const;

  const s = slides[slide];

  return (
    <div className="fixed inset-0 z-40 grid place-items-center bg-bg/90 backdrop-blur-md no-drag">
      <div className="card-elev w-[520px] max-w-[92vw] p-8">
        <div className="flex items-center gap-3">
          <div className="h-12 w-12 rounded-xl bg-accent/15 border border-accent/30 grid place-items-center text-accent">
            <MIcon name={s.icon} size={26} />
          </div>
          <div className="text-xs uppercase tracking-wider text-text-dim">
            Step {slide + 1} of {slides.length}
          </div>
        </div>

        <h2 className="mt-5 text-2xl font-semibold text-text">{s.title}</h2>
        <p className="mt-2 text-sm text-text-muted leading-relaxed">{s.body}</p>

        <div className="mt-8 flex items-center justify-between">
          <div className="flex gap-1.5">
            {slides.map((_, i) => (
              <div
                key={i}
                className={`h-1.5 rounded-full transition-all ${
                  i === slide ? 'bg-accent w-6' : 'bg-border w-1.5'
                }`}
              />
            ))}
          </div>
          <div className="flex gap-2">
            <button className="btn-ghost" onClick={done}>
              Skip
            </button>
            {slide < slides.length - 1 ? (
              <button className="btn-primary" onClick={() => setSlide(slide + 1)}>
                Next
                <MIcon name="arrow_forward" size={14} />
              </button>
            ) : (
              <button className="btn-primary" onClick={done}>
                Get started
                <MIcon name="check" size={14} />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
