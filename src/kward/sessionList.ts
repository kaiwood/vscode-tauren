import { existsSync } from 'node:fs';
import { readdir, readFile, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import type { WebviewSessionItem } from '../webviewProtocol/types';
import type { SessionListProgressOptions } from '../controller/types';
import { isRecord } from '../shared/typeGuards';

export async function listKwardSessions(options: {
  cwd?: string;
  currentSessionFile?: string;
  progress?: SessionListProgressOptions;
} = {}): Promise<WebviewSessionItem[]> {
  const sessionDir = getKwardSessionDir(options.cwd);
  if (!sessionDir || !existsSync(sessionDir)) {
    return [];
  }

  const names = await readdir(sessionDir).catch(() => []);
  const files = names.filter((name) => name.endsWith('.jsonl')).map((name) => join(sessionDir, name));
  const sessions = (await Promise.all(files.map(readKwardSessionItem))).filter((item): item is WebviewSessionItem => Boolean(item));

  sessions.sort((a, b) => Date.parse(b.modified || '') - Date.parse(a.modified || ''));
  return decorateSessions(sessions, options.currentSessionFile);
}

function getKwardSessionDir(cwd: string | undefined): string | undefined {
  if (!cwd) {
    return undefined;
  }

  return join(getKwardConfigDir(), 'sessions', safeCwd(cwd));
}

function getKwardConfigDir(): string {
  const configPath = process.env.KWARD_CONFIG_PATH;
  return configPath ? resolve(configPath, '..') : join(homedir(), '.kward');
}

function safeCwd(cwd: string): string {
  return `--${resolve(cwd).replace(/^[/\\]/, '').replace(/[/\\:]/g, '-')}--`;
}

async function readKwardSessionItem(file: string): Promise<WebviewSessionItem | undefined> {
  try {
    const [stats, content] = await Promise.all([stat(file), readFile(file, 'utf8')]);
    const records = content.split('\n').filter(Boolean).map((line) => {
      try {
        return JSON.parse(line) as unknown;
      } catch {
        return undefined;
      }
    }).filter(isRecord);
    const header = records.find((record) => record.type === 'session');

    if (!header) {
      return undefined;
    }

    const messages = records
      .filter((record) => record.type === 'message' && isRecord(record.message))
      .map((record) => record.message as Record<string, unknown>);
    const latestInfo = records.filter((record) => record.type === 'session_info').at(-1);
    const id = typeof header.id === 'string' ? header.id : file;
    const cwd = typeof header.cwd === 'string' ? header.cwd : '';
    const created = typeof header.timestamp === 'string' ? header.timestamp : stats.birthtime.toISOString();
    const modified = stats.mtime.toISOString();
    const name = isRecord(latestInfo) && typeof latestInfo.name === 'string' ? latestInfo.name : undefined;
    const firstMessage = getFirstUserMessage(messages);

    return {
      path: file,
      id,
      cwd,
      ...(name ? { name } : {}),
      created,
      modified,
      messageCount: messages.length,
      firstMessage,
      depth: 0,
      isLast: false,
      ancestorContinues: [],
      current: false,
      metadataState: 'ready'
    };
  } catch {
    return undefined;
  }
}

function getFirstUserMessage(messages: Array<Record<string, unknown>>): string {
  const firstUser = messages.find((message) => message.role === 'user');
  const content = firstUser?.content;

  if (typeof content === 'string') {
    return content;
  }

  if (Array.isArray(content)) {
    return content.map((entry) => isRecord(entry) && typeof entry.text === 'string' ? entry.text : '').join('').trim();
  }

  return '';
}

function decorateSessions(sessions: WebviewSessionItem[], currentSessionFile: string | undefined): WebviewSessionItem[] {
  return sessions.map((session, index) => ({
    ...session,
    current: Boolean(currentSessionFile && resolve(session.path) === resolve(currentSessionFile)),
    isLast: index === sessions.length - 1,
    ancestorContinues: []
  }));
}
