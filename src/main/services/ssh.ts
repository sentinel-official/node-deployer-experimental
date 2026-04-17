import { Client, type ConnectConfig } from 'ssh2';
import { quote } from 'shell-quote';
import type { SSHCredentials, SSHTestResult } from '../../shared/types';

/**
 * SSH helpers used by the remote deploy pipeline and remote node control.
 *
 *   • testSSHConnection — opens a handshake and runs `uname`.
 *   • runRemote — executes a command, streaming chunks back through onData.
 *   • uploadFile — transfers a string via SFTP instead of shell here-doc, so
 *     config payloads with special chars can't be reinterpreted by the shell.
 *   • shellQuote — safe assembler for commands that mix fixed words + user
 *     values; we strictly use this instead of string interpolation.
 */

export async function testSSHConnection(creds: SSHCredentials): Promise<SSHTestResult> {
  const start = Date.now();
  const config = buildConnectConfig(creds);

  return new Promise<SSHTestResult>((resolve) => {
    const client = new Client();
    let settled = false;
    const finish = (result: SSHTestResult) => {
      if (settled) return;
      settled = true;
      try {
        client.end();
      } catch {
        /* already closed */
      }
      resolve(result);
    };

    client.on('ready', () => {
      client.exec('uname -a || ver', (err, stream) => {
        if (err) {
          finish({ ok: false, message: `Connected, but exec failed: ${err.message}` });
          return;
        }
        let buf = '';
        stream
          .on('close', () =>
            finish({
              ok: true,
              message: 'Connection successful',
              osInfo: buf.trim() || 'unknown',
              latencyMs: Date.now() - start,
            }),
          )
          .on('data', (c: Buffer) => (buf += c.toString('utf8')))
          .stderr.on('data', (c: Buffer) => (buf += c.toString('utf8')));
      });
    });

    client.on('error', (err) => finish({ ok: false, message: err.message }));

    try {
      client.connect(config);
    } catch (err) {
      finish({ ok: false, message: (err as Error).message });
    }
  });
}

export function buildConnectConfig(creds: SSHCredentials): ConnectConfig {
  const base: ConnectConfig = {
    host: creds.host,
    port: creds.port || 22,
    username: creds.username,
    readyTimeout: 12_000,
    keepaliveInterval: 15_000,
  };
  if (creds.privateKey && creds.privateKey.trim()) {
    base.privateKey = creds.privateKey;
    if (creds.passphrase) base.passphrase = creds.passphrase;
  } else if (creds.password) {
    base.password = creds.password;
  }
  return base;
}

export function runRemote(
  client: Client,
  command: string,
  onData?: (chunk: string) => void,
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    client.exec(command, (err, stream) => {
      if (err) {
        reject(err);
        return;
      }
      let stdout = '';
      let stderr = '';
      stream
        .on('close', (code: number) => resolve({ code: code ?? 0, stdout, stderr }))
        .on('data', (chunk: Buffer) => {
          const text = chunk.toString('utf8');
          stdout += text;
          onData?.(text);
        })
        .stderr.on('data', (chunk: Buffer) => {
          const text = chunk.toString('utf8');
          stderr += text;
          onData?.(text);
        });
    });
  });
}

export async function uploadFile(
  client: Client,
  remotePath: string,
  content: string,
  mode: number = 0o644,
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    client.sftp((err, sftp) => {
      if (err) {
        reject(err);
        return;
      }
      const stream = sftp.createWriteStream(remotePath, { mode });
      stream.once('close', () => resolve());
      stream.once('error', reject);
      stream.end(Buffer.from(content, 'utf8'));
    });
  });
}

export async function mkdirRemote(client: Client, dir: string): Promise<void> {
  const cmd = shellQuote(['mkdir', '-p', dir]);
  const { code, stderr } = await runRemote(client, cmd);
  if (code !== 0) throw new Error(`mkdir -p ${dir} failed: ${stderr.trim()}`);
}

export function shellQuote(parts: string[]): string {
  return quote(parts);
}

/** Connect + run + disconnect with a callback. */
export async function withSSH<T>(
  creds: SSHCredentials,
  fn: (client: Client) => Promise<T>,
): Promise<T> {
  const client = new Client();
  await new Promise<void>((resolve, reject) => {
    client.once('ready', () => resolve());
    client.once('error', reject);
    client.connect(buildConnectConfig(creds));
  });
  try {
    return await fn(client);
  } finally {
    try {
      client.end();
    } catch {
      /* already closed */
    }
  }
}
