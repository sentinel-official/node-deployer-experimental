import Docker from 'dockerode';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { log } from './logger';
import { getSettings } from './settings';

/**
 * Inlined Dockerfile for the sentinel-dvpnx node runtime.
 *
 * Upstream publishes **no release binaries**, so we build from source —
 * mirroring the canonical Dockerfile in sentinel-official/sentinel-dvpnx
 * and sentinel-official/sentinelhub. The final image carries:
 *
 *   /usr/local/bin/dvpnx        — sentinel-dvpnx node daemon
 *   /usr/local/bin/sentinelhub  — Sentinel chain CLI (for key mgmt + tx)
 *
 * First build takes 5–15 minutes on a fresh machine; subsequent deploys
 * reuse the cached image.
 */
export const SENTINEL_DVPNX_DOCKERFILE = `# syntax=docker/dockerfile:1.6
ARG DVPNX_REF=v8.3.1
ARG HUB_REF=v12.0.2

# Go 1.24 is the version sentinel-dvpnx pins in go.mod. We pin explicitly
# with GOTOOLCHAIN=local so Go doesn't silently upgrade to 1.26 (which
# breaks bytedance/sonic's runtime internal hooks).

# ---------- sentinel-dvpnx build -------------------------------------------
FROM golang:1.24-alpine3.21 AS build-dvpnx
ENV GOTOOLCHAIN=local
ARG DVPNX_REF
WORKDIR /src
RUN apk add --no-cache --no-scripts autoconf automake bash file g++ gcc git libtool \\
    linux-headers make musl-dev unbound-dev && apk fix 2>/dev/null || true
RUN git clone --branch=\${DVPNX_REF} --depth=1 https://github.com/sentinel-official/sentinel-dvpnx.git .
RUN --mount=type=cache,target=/go/pkg/mod \\
    --mount=type=cache,target=/root/.cache/go-build \\
    make --jobs=$(nproc) install

# ---------- sentinelhub build ----------------------------------------------
FROM golang:1.24-alpine3.21 AS build-hub
ENV GOTOOLCHAIN=local
ARG HUB_REF
WORKDIR /src
RUN apk add --no-cache --no-scripts build-base ca-certificates git linux-headers wget && apk fix 2>/dev/null || true
RUN git clone --branch=\${HUB_REF} --depth=1 https://github.com/sentinel-official/sentinelhub.git .
RUN ARCH=$(uname -m) && \\
    WASM_VERSION=$(go list -m all | grep github.com/CosmWasm/wasmvm | awk '{print $NF}') && \\
    echo "downloading libwasmvm_muslc.\${ARCH}.a @ \${WASM_VERSION}" && \\
    wget -q -O /usr/local/lib/libwasmvm_muslc.a \\
        "https://github.com/CosmWasm/wasmvm/releases/download/\${WASM_VERSION}/libwasmvm_muslc.\${ARCH}.a"
RUN --mount=type=cache,target=/go/pkg/mod \\
    --mount=type=cache,target=/root/.cache/go-build \\
    STATIC=true make --jobs=$(nproc) build

# ---------- runtime --------------------------------------------------------
FROM alpine:3.21
# --no-scripts + apk fix fallback: on some hosts (notably Debian 12 with
# older kernels), Alpine's busybox trigger fails at post-install on newer
# package versions. Skipping scripts during add and calling apk fix
# afterwards is the recommended workaround from alpinelinux-discuss.
RUN apk add --no-cache --no-scripts bash ca-certificates iptables openvpn unbound-libs \\
    v2ray wireguard-tools && \\
    (apk fix 2>/dev/null || true) && \\
    rm -rf /etc/v2ray/ /usr/share/v2ray/
COPY --from=build-dvpnx /go/bin/sentinel-dvpnx /usr/local/bin/dvpnx
COPY --from=build-hub   /src/bin/sentinelhub   /usr/local/bin/sentinelhub
VOLUME ["/root/.sentinel-dvpnx"]
EXPOSE 7777/udp 7777/tcp 19781/tcp
ENTRYPOINT ["dvpnx"]
CMD ["start"]
`;

/**
 * Docker daemon control.
 *
 * On macOS / Windows the app communicates with Docker Desktop via its
 * Unix socket (macOS) or named pipe (Windows). On Linux it's the system
 * socket at /var/run/docker.sock. The Settings `dockerSocket` lets the
 * user override (useful for Podman, colima, or rootless setups).
 *
 * We only ever read/write under /root/.sentinel-dvpnx inside the
 * container; the host mount is userData/nodes/<nodeId>.
 */

export const IMAGE_TAG = 'sentinel-dvpn-app/sentinel-dvpnx:v8.3.1';
export const IMAGE_VERSION = 'v8.3.1';

let client: Docker | null = null;

function candidateSockets(override: string): string[] {
  if (override) return [override];
  if (process.platform === 'win32') {
    return ['//./pipe/docker_engine'];
  }
  return [
    '/var/run/docker.sock',
    `${os.homedir()}/.docker/run/docker.sock`,      // Docker Desktop on macOS (new)
    `${os.homedir()}/.docker/desktop/docker.sock`,  // Docker Desktop on macOS (older)
    `${os.homedir()}/.colima/default/docker.sock`,  // Colima
    `${os.homedir()}/.colima/docker.sock`,
  ];
}

export async function getClient(): Promise<Docker> {
  if (client) return client;
  const settings = await getSettings();
  const candidates = candidateSockets(settings.dockerSocket);
  for (const sock of candidates) {
    try {
      const isPipe = sock.startsWith('//');
      const c = isPipe ? new Docker({ socketPath: sock }) : new Docker({ socketPath: sock });
      // ping forces a real handshake with the daemon
      await c.ping();
      client = c;
      log.info('docker connected', { socket: sock });
      return c;
    } catch (err) {
      log.debug('docker socket probe failed', { sock, err: (err as Error).message });
    }
  }
  throw new Error(
    'Could not reach the Docker daemon. Install Docker Desktop (macOS / Windows) or Docker Engine (Linux) and make sure it is running. If you use an alternative (Colima, Podman), set the socket path in Settings.',
  );
}

export interface DockerHealth {
  reachable: boolean;
  version?: string;
  error?: string;
  socket?: string;
}

export async function dockerHealth(): Promise<DockerHealth> {
  try {
    const c = await getClient();
    const info = await c.version();
    return { reachable: true, version: info.Version };
  } catch (err) {
    return { reachable: false, error: (err as Error).message };
  }
}

// ---------------------------------------------------------------------------
// Image lifecycle
// ---------------------------------------------------------------------------

export async function hasImage(tag: string): Promise<boolean> {
  const c = await getClient();
  try {
    const img = c.getImage(tag);
    await img.inspect();
    return true;
  } catch {
    return false;
  }
}

/**
 * Build the sentinel-dvpnx image if we don't already have it locally.
 * Streams build output via the `onLog` callback.
 *
 * The Dockerfile is embedded in this file as a string — we materialize it
 * to a short-lived temp directory so dockerode can use it as a build
 * context. That avoids any runtime path resolution across dev vs packaged.
 */
export async function ensureImage(
  tag: string,
  onLog: (line: string) => void = () => undefined,
): Promise<void> {
  if (await hasImage(tag)) return;
  const c = await getClient();

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sentinel-dvpnx-build-'));
  const dockerfilePath = path.join(tmpDir, 'Dockerfile');
  await fs.writeFile(dockerfilePath, SENTINEL_DVPNX_DOCKERFILE, 'utf8');
  onLog(`[docker] building ${tag} (context=${tmpDir})`);

  try {
    const stream = await c.buildImage(
      { context: tmpDir, src: ['Dockerfile'] },
      {
        t: tag,
        dockerfile: 'Dockerfile',
        buildargs: { SENTINEL_DVPNX_VERSION: IMAGE_VERSION },
      },
    );

    await new Promise<void>((resolve, reject) => {
      c.modem.followProgress(
        stream,
        (err) => (err ? reject(err) : resolve()),
        (evt: { stream?: string; error?: string }) => {
          if (evt.error) onLog(`[docker] ${evt.error}`);
          if (evt.stream) {
            for (const line of evt.stream.split(/\r?\n/)) {
              if (line.trim()) onLog(`[docker] ${line.trim()}`);
            }
          }
        },
      );
    });
    onLog(`[docker] image ${tag} built`);
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

// ---------------------------------------------------------------------------
// Container lifecycle for sentinel-dvpnx nodes
// ---------------------------------------------------------------------------

export interface RunNodeOptions {
  nodeId: string;
  hostDataDir: string; // mounted to /root/.sentinel-dvpnx
  port: number;
  apiPort: number;
  imageTag: string;
  /** Arguments passed to the sentinel-dvpnx entrypoint. */
  cmd?: string[];
}

export function containerName(nodeId: string): string {
  return `sentinel-dvpn-${nodeId.slice(0, 12)}`;
}

export async function runNode(opts: RunNodeOptions): Promise<string> {
  const c = await getClient();
  const name = containerName(opts.nodeId);

  // Remove any previous container with the same name (stale from a prior deploy).
  try {
    const existing = c.getContainer(name);
    await existing.inspect();
    try {
      await existing.stop();
    } catch {
      /* not running */
    }
    await existing.remove();
  } catch {
    /* none exists */
  }

  await fs.mkdir(opts.hostDataDir, { recursive: true });

  const container = await c.createContainer({
    name,
    Image: opts.imageTag,
    Cmd: opts.cmd ?? ['start'],
    Tty: false,
    AttachStdout: true,
    AttachStderr: true,
    HostConfig: {
      RestartPolicy: { Name: 'unless-stopped' },
      Binds: [`${opts.hostDataDir}:/root/.sentinel-dvpnx`],
      CapAdd: ['NET_ADMIN', 'NET_RAW'],
      CapDrop: ['ALL'],
      Devices: [
        {
          PathOnHost: '/dev/net/tun',
          PathInContainer: '/dev/net/tun',
          CgroupPermissions: 'rwm',
        },
      ],
      PortBindings: {
        [`${opts.port}/udp`]: [{ HostPort: String(opts.port) }],
        [`${opts.port}/tcp`]: [{ HostPort: String(opts.port) }],
        [`${opts.apiPort}/tcp`]: [{ HostPort: String(opts.apiPort) }],
      },
    },
    ExposedPorts: {
      [`${opts.port}/udp`]: {},
      [`${opts.port}/tcp`]: {},
      [`${opts.apiPort}/tcp`]: {},
    },
  });
  await container.start();
  return container.id;
}

/**
 * Run a short-lived container (e.g. `sentinel-dvpnx init`) and return
 * captured stdout+stderr once the container exits. The host data dir is
 * mounted in so any state generated persists for the long-running node.
 */
export async function runOnce(opts: {
  hostDataDir: string;
  imageTag: string;
  cmd: string[];
  stdin?: string;
  onLog?: (line: string) => void;
}): Promise<{ exitCode: number; output: string }> {
  const c = await getClient();
  await fs.mkdir(opts.hostDataDir, { recursive: true });

  const container = await c.createContainer({
    Image: opts.imageTag,
    Cmd: opts.cmd,
    Tty: false,
    OpenStdin: Boolean(opts.stdin),
    StdinOnce: Boolean(opts.stdin),
    AttachStdin: Boolean(opts.stdin),
    AttachStdout: true,
    AttachStderr: true,
    HostConfig: {
      Binds: [`${opts.hostDataDir}:/root/.sentinel-dvpnx`],
      AutoRemove: false, // we keep it so we can `wait` for exit code
    },
  });

  const stream = await container.attach({
    stream: true,
    stdout: true,
    stderr: true,
    stdin: Boolean(opts.stdin),
  });
  const chunks: Buffer[] = [];
  stream.on('data', (chunk: Buffer) => {
    chunks.push(chunk);
    opts.onLog?.(stripDockerFrames(chunk));
  });

  await container.start();
  if (opts.stdin) {
    stream.write(opts.stdin);
    stream.end();
  }
  const exit = await container.wait();
  try {
    await container.remove({ force: true });
  } catch {
    /* already gone */
  }

  return {
    exitCode: Number(exit?.StatusCode ?? 0),
    output: stripDockerFrames(Buffer.concat(chunks)),
  };
}

/** Fetch the last N lines of a container's combined stdout/stderr. */
export async function containerLogs(containerId: string, tail = 200): Promise<string[]> {
  const c = await getClient();
  try {
    const container = c.getContainer(containerId);
    // follow:false resolves to a Buffer-ish payload; cast via unknown.
    const raw: unknown = await container.logs({
      stdout: true,
      stderr: true,
      tail,
      follow: false,
      timestamps: false,
    } as never);
    const buf = Buffer.isBuffer(raw) ? raw : Buffer.from(String(raw), 'utf8');
    return stripDockerFrames(buf).split(/\r?\n/).filter(Boolean);
  } catch (err) {
    log.debug('containerLogs failed', { id: containerId.slice(0, 12), err: (err as Error).message });
    return [];
  }
}

export async function stopContainer(containerId: string): Promise<void> {
  const c = await getClient();
  try {
    const container = c.getContainer(containerId);
    await container.stop({ t: 5 });
  } catch (err) {
    log.debug('stopContainer (already stopped?)', { err: (err as Error).message });
  }
}

export async function restartContainer(containerId: string): Promise<void> {
  const c = await getClient();
  const container = c.getContainer(containerId);
  await container.restart({ t: 5 });
}

export async function removeContainer(containerId: string): Promise<void> {
  const c = await getClient();
  try {
    const container = c.getContainer(containerId);
    try {
      await container.stop({ t: 5 });
    } catch {
      /* not running */
    }
    await container.remove({ force: true });
  } catch (err) {
    log.debug('removeContainer failed', { err: (err as Error).message });
  }
}

export async function isRunning(containerId: string): Promise<boolean> {
  const c = await getClient();
  try {
    const info = await c.getContainer(containerId).inspect();
    return Boolean(info.State.Running);
  } catch {
    return false;
  }
}

/** Run a command inside an already-running container and capture output. */
export async function execInside(
  containerId: string,
  cmd: string[],
): Promise<{ exitCode: number; output: string }> {
  const c = await getClient();
  const exec = await c.getContainer(containerId).exec({
    Cmd: cmd,
    AttachStdout: true,
    AttachStderr: true,
  });
  const stream = await exec.start({});
  const chunks: Buffer[] = [];
  await new Promise<void>((resolve, reject) => {
    stream.on('data', (chunk: Buffer) => chunks.push(chunk));
    stream.on('end', () => resolve());
    stream.on('error', reject);
  });
  const info = await exec.inspect();
  return {
    exitCode: info.ExitCode ?? -1,
    output: stripDockerFrames(Buffer.concat(chunks)),
  };
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

/**
 * Docker's log stream multiplexes stdout + stderr with an 8-byte header
 * per frame. Strip headers and decode.
 */
function stripDockerFrames(buf: Buffer): string {
  let out = '';
  let p = 0;
  while (p < buf.length) {
    // frame = [stream(1), _, _, _, sizeBE(4), payload]
    const size = buf.readUInt32BE(p + 4);
    if (Number.isNaN(size) || p + 8 + size > buf.length || size < 0 || size > 10 * 1024 * 1024) {
      // Not a framed payload — return raw.
      return buf.toString('utf8');
    }
    out += buf.slice(p + 8, p + 8 + size).toString('utf8');
    p += 8 + size;
  }
  return out;
}
