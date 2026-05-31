import { createReadStream } from 'fs';
import { stat } from 'fs/promises';
import { extractPiMessageText } from '../pi/messageContent';
import type { WebviewSessionItem } from '../webviewProtocol/types';
import {
  filterAndSortSessionSearchItems,
  normalizeSessionSearchText,
  type SearchableSession
} from './sessionSearchMatcher';
import { isRecord } from '../shared/typeGuards';

export const defaultSessionSearchTranscriptLimit = 50 * 1024;

const maxConcurrentSessionSearchIndexReads = 2;

export type SessionSearchIndexProgress = {
  indexedCount: number;
  totalCount: number;
  indexing: boolean;
};

export type SessionSearchIndexResult = SessionSearchIndexProgress & {
  matchedSessionPaths: string[];
};

export type SessionSearchIndexOptions = {
  transcriptLimit?: number;
};

type SessionSearchIndexEntry = {
  path: string;
  id: string;
  cwd: string;
  name?: string;
  firstMessage: string;
  modifiedTime: number;
  messageCount: number;
  summaryKey: string;
  lightText: string;
  transcriptText: string;
  fullReady: boolean;
  loading: boolean;
};

type CachedTranscriptText = {
  mtimeMs: number;
  size: number;
  text: string;
};

export class SessionSearchIndex {
  private readonly transcriptLimit: number;
  private readonly entries = new Map<string, SessionSearchIndexEntry>();
  private readonly transcriptCache = new Map<string, CachedTranscriptText>();
  private order: string[] = [];
  private indexingPromise: Promise<void> | undefined;
  private progressCallback: (() => void) | undefined;

  public constructor(options: SessionSearchIndexOptions = {}) {
    this.transcriptLimit = Math.max(0, Math.floor(options.transcriptLimit ?? defaultSessionSearchTranscriptLimit));
  }

  public setSessions(sessions: readonly WebviewSessionItem[]): void {
    const seen = new Set<string>();
    const nextOrder: string[] = [];

    for (const session of sessions) {
      seen.add(session.path);
      nextOrder.push(session.path);
      this.upsertSession(session);
    }

    for (const path of Array.from(this.entries.keys())) {
      if (!seen.has(path)) {
        this.entries.delete(path);
      }
    }

    for (const path of Array.from(this.transcriptCache.keys())) {
      if (!seen.has(path)) {
        this.transcriptCache.delete(path);
      }
    }

    this.order = nextOrder;
  }

  public getProgress(): SessionSearchIndexProgress {
    const entries = Array.from(this.entries.values());

    return {
      indexedCount: entries.filter((entry) => entry.fullReady).length,
      totalCount: entries.length,
      indexing: Boolean(this.indexingPromise)
    };
  }

  public search(query: string, options: { namedOnly?: boolean } = {}): SessionSearchIndexResult {
    const searchable = this.order
      .map((path) => this.entries.get(path))
      .filter((entry): entry is SessionSearchIndexEntry => Boolean(entry))
      .map((entry): SearchableSession => ({
        path: entry.path,
        name: entry.name,
        text: entry.transcriptText
          ? `${entry.lightText} ${entry.transcriptText}`
          : entry.lightText,
        modifiedTime: entry.modifiedTime
      }));

    return {
      ...this.getProgress(),
      matchedSessionPaths: filterAndSortSessionSearchItems(searchable, query, options)
    };
  }

  public startIndexing(onProgress?: () => void): void {
    if (onProgress) {
      this.progressCallback = onProgress;
    }

    if (this.indexingPromise || this.getProgress().indexedCount >= this.entries.size) {
      return;
    }

    this.indexingPromise = this.indexPendingEntries()
      .catch(() => undefined)
      .finally(() => {
        this.indexingPromise = undefined;
        this.progressCallback?.();
      });
  }

  private upsertSession(session: WebviewSessionItem): void {
    const existing = this.entries.get(session.path);
    const nextSummaryKey = createSummaryKey(session);
    const lightText = createLightSearchText(session);
    const modifiedTime = Date.parse(session.modified);

    if (!existing) {
      this.entries.set(session.path, {
        path: session.path,
        id: session.id,
        cwd: session.cwd,
        name: session.name,
        firstMessage: session.firstMessage,
        modifiedTime: Number.isFinite(modifiedTime) ? modifiedTime : 0,
        messageCount: session.messageCount,
        summaryKey: nextSummaryKey,
        lightText,
        transcriptText: '',
        fullReady: false,
        loading: false
      });
      return;
    }

    const summaryChanged = existing.summaryKey !== nextSummaryKey;
    existing.id = session.id;
    existing.cwd = session.cwd;
    existing.name = session.name;
    existing.firstMessage = session.firstMessage;
    existing.modifiedTime = Number.isFinite(modifiedTime) ? modifiedTime : 0;
    existing.messageCount = session.messageCount;
    existing.summaryKey = nextSummaryKey;
    existing.lightText = lightText;

    if (summaryChanged) {
      existing.fullReady = false;
      existing.transcriptText = '';
    }
  }

  private async indexPendingEntries(): Promise<void> {
    const workerCount = Math.min(maxConcurrentSessionSearchIndexReads, this.entries.size);

    if (workerCount <= 0) {
      return;
    }

    await Promise.all(Array.from({ length: workerCount }, () => this.indexWorker()));
  }

  private async indexWorker(): Promise<void> {
    for (;;) {
      const entry = this.takeNextPendingEntry();

      if (!entry) {
        return;
      }

      try {
        const transcriptText = await this.readTranscriptText(entry.path);
        const current = this.entries.get(entry.path);

        if (current === entry) {
          entry.transcriptText = transcriptText;
          entry.fullReady = true;
        }
      } catch {
        const current = this.entries.get(entry.path);

        if (current === entry) {
          entry.transcriptText = '';
          entry.fullReady = true;
        }
      } finally {
        if (this.entries.get(entry.path) === entry) {
          entry.loading = false;
          this.progressCallback?.();
        }
      }
    }
  }

  private takeNextPendingEntry(): SessionSearchIndexEntry | undefined {
    for (const path of this.order) {
      const entry = this.entries.get(path);

      if (entry && !entry.fullReady && !entry.loading) {
        entry.loading = true;
        return entry;
      }
    }

    return undefined;
  }

  private async readTranscriptText(path: string): Promise<string> {
    const stats = await stat(path);
    const cached = this.transcriptCache.get(path);

    if (cached && cached.mtimeMs === stats.mtimeMs && cached.size === stats.size) {
      return cached.text;
    }

    const text = await readSessionTranscriptExcerpt(path, this.transcriptLimit);
    this.transcriptCache.set(path, {
      mtimeMs: stats.mtimeMs,
      size: stats.size,
      text
    });
    return text;
  }
}

export async function readSessionTranscriptExcerpt(filePath: string, maxChars: number): Promise<string> {
  let text = '';
  const limit = Math.max(0, Math.floor(maxChars));

  if (limit === 0) {
    return '';
  }

  for await (const line of iterSessionJsonlLines(filePath)) {
    if (text.length >= limit) {
      break;
    }

    const entry = parseJsonlRecord(line);

    if (!entry || entry.type !== 'message' || !isRecord(entry.message)) {
      continue;
    }

    const role = entry.message.role;

    if (role !== 'user' && role !== 'assistant') {
      continue;
    }

    const messageText = extractPiMessageText(entry.message.content, { separator: ' ' }).trim();

    if (!messageText) {
      continue;
    }

    text = appendLimitedText(text, messageText, limit);
  }

  return normalizeSessionSearchText(text);
}

function createLightSearchText(session: WebviewSessionItem): string {
  return normalizeSessionSearchText([
    session.id,
    session.name ?? '',
    session.firstMessage,
    session.cwd
  ].join(' '));
}

function createSummaryKey(session: WebviewSessionItem): string {
  return [
    session.id,
    session.cwd,
    session.name ?? '',
    session.firstMessage,
    session.modified,
    String(session.messageCount)
  ].join('\0');
}

function appendLimitedText(current: string, next: string, limit: number): string {
  const separator = current ? ' ' : '';
  const candidate = separator + next;
  const remaining = limit - current.length;

  if (remaining <= 0) {
    return current;
  }

  return current + candidate.slice(0, remaining);
}

async function* iterSessionJsonlLines(filePath: string): AsyncGenerator<string> {
  let buffer = '';

  for await (const chunk of createReadStream(filePath, { encoding: 'utf8' })) {
    buffer += chunk;

    for (;;) {
      const lineEnd = buffer.indexOf('\n');

      if (lineEnd === -1) {
        break;
      }

      yield buffer.slice(0, lineEnd);
      buffer = buffer.slice(lineEnd + 1);
    }
  }

  if (buffer) {
    yield buffer;
  }
}

function parseJsonlRecord(line: string): Record<string, unknown> | undefined {
  const trimmed = line.trim();

  if (!trimmed) {
    return undefined;
  }

  try {
    const parsed: unknown = JSON.parse(trimmed);
    return isRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}
