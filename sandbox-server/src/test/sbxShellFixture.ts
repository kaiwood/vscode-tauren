import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { access, mkdtemp, mkdir, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { quoteRemoteArgument } from '@tauren/shared/ssh/serverLaunch';
import { stageSbxPayload } from './sbxPayload.js';

/** Real SBX lifecycle fixture. SBX supplies the SSH endpoint and authentication;
 * no local daemon, ports, host keys or OS account changes are required.
 */
export async function createSbxShellFixture() {
  const sbx = process.env.SBX_PATH || 'sbx';
  const ssh = process.env.SSH_PATH || 'ssh';
  const nodeMixin = fileURLToPath(new URL('../../test-resources/node-shell-mixin/', import.meta.url));
  await access(path.join(nodeMixin, 'spec.yaml'));
  const nodePath = '/opt/tauren-test-node/bin/node';
  const name = `tauren-ssh-${randomUUID().slice(0, 8)}`;
  const root = await mkdtemp(path.join(tmpdir(), 'tauren-sbx-ssh-'));
  // Writable primary workspace, mirrored at this same absolute path in the VM.
  // Tests create Pi's working directory, settings/HOME, session store, launcher
  // scripts and PID markers underneath it. Real write/edit tools need this mount
  // writable; it is separate from the read-only fixture implementation below.
  const directory = path.join(root, 'state');
  // Read-only additional workspace containing built server code, shared helpers,
  // dependencies and fixture extensions. Keep it a sibling of state/, not nested
  // under that writable mount, so the code cannot be modified through another path.
  const payloadDirectory = path.join(root, 'payload');
  const clients = new Set<ChildProcessWithoutNullStreams>();
  let diagnostics = '';
  let creationAttempted = false;
  let closing: Promise<void> | undefined;

  /** Run a finite host-side command and await its exit, collecting stdout/stderr
   * with a timeout. Use for SBX lifecycle commands and short SSH probes via run().
   * stdin is closed immediately, so do not use this for the interactive JSON-RPC
   * server connection; use launch() to retain its pipes. Local argv is executed
   * directly; any SSH remote-command string must be quoted separately.
   */
  async function runLocal(executable: string, args: string[], timeout = 30_000): Promise<string> {
    const child = spawn(executable, args, { stdio: ['pipe', 'pipe', 'pipe'] });
    child.stdin.end();
    let stdout = '', stderr = '';
    child.stdout.on('data', data => { stdout += data.toString(); });
    child.stderr.on('data', data => { stderr += data.toString(); });
    const timer = setTimeout(() => child.kill('SIGKILL'), timeout);
    try {
      await new Promise<void>((resolve, reject) => {
        child.once('error', reject);
        child.once('close', (code, signal) => code === 0 ? resolve() : reject(
          new Error(`${executable} failed (${signal ?? code}): ${stderr}\n${stdout}`)));
      });
      return stdout;
    } finally { clearTimeout(timer); diagnostics = (diagnostics + stderr).slice(-128_000); }
  }
  function sshArgs(command: string): string[] {
    // Use SBX's configured SSH alias/host trust. Never disable host verification.
    return ['-T', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=20', '-o', 'ControlMaster=no',
      '-o', 'ControlPath=none', `${name}.sbx`, command];
  }
  /** Open a long-lived SSH connection to the sandbox and return the child without
   * waiting for exit. Use for the server's bidirectional JSON-RPC session: callers
   * keep stdin open, read framed stdout, and own shutdown/disconnect assertions.
   * Unlike runLocal(), this does not collect a completed result or impose a command
   * timeout; protocol tests bound their own waits. For finite lifecycle commands
   * use runLocal(), or run() for a short remote SSH probe.
   */
  function launch(command: string): ChildProcessWithoutNullStreams {
    if (closing) throw new Error('SBX fixture is closed');
    const child = spawn(ssh, sshArgs(command), { stdio: ['pipe', 'pipe', 'pipe'] });
    clients.add(child);
    child.once('close', () => clients.delete(child));
    child.stderr.on('data', data => { diagnostics = (diagnostics + data.toString()).slice(-128_000); });
    return child;
  }
  /** Inspect the VM through a separate SSH connection, including remote /proc. */
  async function run(command: string): Promise<string> { return runLocal(ssh, sshArgs(command)); }
  /** Removal is a safety net, not evidence of server disconnect cleanup. */
  function close(): Promise<void> {
    closing ??= (async () => {
      try {
        for (const child of clients) {
          child.stdin.destroy();
          child.kill('SIGKILL');
        }
        if (creationAttempted) {
          try { await runLocal(sbx, ['--no-input', 'rm', '--force', name], 120_000); }
          catch (error) {
            if (!(error instanceof Error) || !error.message.includes(`sandbox '${name}' not found`)) throw error;
          }
        }
      } finally { await rm(root, { recursive: true, force: true }); }
    })();
    return closing;
  }

  try {
    // Fail explicitly: this opt-in gate requires host SBX login/setup ssh.
    await runLocal(sbx, ['--version']);
    await runLocal(ssh, ['-V']);
    await mkdir(directory);
    await stageSbxPayload(payloadDirectory);
    creationAttempted = true;
    // First operand is the writable primary workspace; PATH:ro adds a separate
    // read-only code workspace. Without target overrides, both retain their host
    // absolute paths inside the VM, allowing host assertions on test output files.
    await runLocal(sbx, ['--no-input', 'create', '--name', name, '--kit', nodeMixin, 'shell', directory,
      `${payloadDirectory}:ro`], 600_000);
    // A successful SSH command, not sandbox creation, establishes readiness.
    await run('true');
    // Never select the base image's Node or rely on PATH/profile setup. This
    // exact executable is installed by the composed test-only Node mixin.
    const nodeVersion = (await run(`${quoteRemoteArgument(nodePath)} --version`)).trim();
    if (nodeVersion !== 'v22.22.1') throw new Error(`Unexpected mixin Node version: ${nodeVersion}`);
    return { directory, remoteDirectory: directory, payloadDirectory, nodePath,
      serverPath: path.join(payloadDirectory, 'server/dist/main.js'),
      extensions: ['offline-provider.js', 'ui-extension.js'].map(file => path.join(payloadDirectory, 'server/dist/test/fixtures', file)),
      launch, run, close, get stderr() { return diagnostics; } };
  } catch (cause) {
    try { await close(); }
    catch (cleanup) { throw new AggregateError([cause, cleanup], 'SBX shell fixture setup and cleanup failed'); }
    throw new Error('SBX shell fixture failed. Run on a host with sbx, login and setup ssh configured; '
      + 'SBX must support the built-in v3 shell kit, the Node-install mixin capabilities, and read-only additional workspaces. '
      + String(cause), { cause });
  }
}
/** Infer the fixture's public shape from its factory: ReturnType gets the returned
 * Promise type, and Awaited unwraps it to the fixture object callers receive.
 * This keeps the type synchronized with the factory without a duplicate interface.
 */
export type SbxShellFixture = Awaited<ReturnType<typeof createSbxShellFixture>>;
