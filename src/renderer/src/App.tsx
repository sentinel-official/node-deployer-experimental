import { useEffect } from 'react';
import { useApp } from './store/app';
import { Layout } from './components/Layout';
import { WalletSetup } from './screens/WalletSetup';
import { Overview } from './screens/Overview';
import { Nodes } from './screens/Nodes';
import { NodeDetails } from './screens/NodeDetails';
import { Deploy } from './screens/Deploy';
import { RemoteSetup } from './screens/RemoteSetup';
import { Progress } from './screens/Progress';
import { Wallet } from './screens/Wallet';
import { Settings } from './screens/Settings';
import { Help } from './screens/Help';

export default function App() {
  const { route, bootstrap, walletBootstrapped } = useApp();

  useEffect(() => {
    void bootstrap();
  }, [bootstrap]);

  if (!walletBootstrapped) {
    return (
      <div className="h-full grid place-items-center text-text-muted text-sm">
        Initializing…
      </div>
    );
  }

  return (
    <Layout>
      {route.name === 'wallet-setup' && <WalletSetup />}
      {route.name === 'overview' && <Overview />}
      {route.name === 'nodes' && <Nodes />}
      {route.name === 'node-details' && <NodeDetails id={route.id} />}
      {route.name === 'deploy' && <Deploy />}
      {route.name === 'remote-setup' && <RemoteSetup />}
      {route.name === 'progress' && (
        <Progress jobId={route.jobId} moniker={route.moniker} />
      )}
      {route.name === 'wallet' && <Wallet />}
      {route.name === 'settings' && <Settings />}
      {route.name === 'help' && <Help />}
    </Layout>
  );
}
