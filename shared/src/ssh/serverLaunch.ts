import path from 'node:path';

export interface ServerLaunchOptions {
  /** Absolute Node executable and built server entrypoint inside the remote machine. */
  nodePath: string;
  serverPath: string;
  workspace: string;
  sessionDirectory: string;
}

/** Quote one argument for the POSIX login shell used by SSH remote commands.
 * Local spawn argv does not prevent the remote shell from interpreting a command;
 * single quotes, including embedded quotes, must be escaped independently.
 */
export function quoteRemoteArgument(value: string): string {
  if (value.includes('\0')) throw new Error('Remote arguments must not contain NUL');
  return `'${value.replaceAll("'", "'\\''")}'`;
}

/** Construct the single remote command passed after `ssh -T <destination>`.
 * Do not source profiles or rely on SendEnv: cwd and session storage are explicit.
 * exec replaces the login shell so EOF/signals reach the per-connection server.
 * Workspace is also sent through initialize and validated by the server.
 */
export function buildServerLaunchCommand(options: ServerLaunchOptions): string {
  for (const name of ['nodePath', 'serverPath', 'workspace', 'sessionDirectory'] as const) {
    const value = options[name];
    if (typeof value !== 'string' || !path.posix.isAbsolute(value) || value.includes('\0')) {
      throw new Error(`${name} must be an absolute remote POSIX path`);
    }
  }
  return `cd ${quoteRemoteArgument(options.workspace)} && exec env ${quoteRemoteArgument(
    `PI_CODING_AGENT_SESSION_DIR=${options.sessionDirectory}`)} ${quoteRemoteArgument(options.nodePath)} ${quoteRemoteArgument(options.serverPath)}`;
}
