import type { WebviewPromptContextAttachment } from '../webviewProtocol/types';
import type { PiPromptContextAttachment, PiPromptContextInput } from './types';

export class PromptContextStore {
  private sequence = 0;
  private attachments: PiPromptContextAttachment[] = [];

  public add(context: PiPromptContextInput | PiPromptContextInput[]): boolean {
    const entries = Array.isArray(context) ? context : [context];
    const attachments = entries.flatMap((entry) => this.createAttachment(entry));

    if (attachments.length === 0) {
      return false;
    }

    this.attachments.push(...attachments);
    return true;
  }

  public remove(id: string): boolean {
    const nextAttachments = this.attachments.filter((attachment) => attachment.id !== id);

    if (nextAttachments.length === this.attachments.length) {
      return false;
    }

    this.attachments = nextAttachments;
    return true;
  }

  public getWebviewAttachments(): WebviewPromptContextAttachment[] {
    return this.attachments.map((attachment) => ({
      id: attachment.id,
      kind: attachment.kind,
      label: attachment.label,
      title: attachment.title,
      ...(attachment.source ? { source: attachment.source } : {})
    }));
  }

  public consume(): PiPromptContextAttachment[] {
    if (this.attachments.length === 0) {
      return [];
    }

    const context = this.attachments.map((attachment) => ({ ...attachment }));
    this.attachments = [];
    return context;
  }

  public restore(context: PiPromptContextAttachment[]): void {
    if (context.length === 0) {
      return;
    }

    this.attachments = [
      ...context.map((attachment) => ({ ...attachment })),
      ...this.attachments
    ];
    this.syncSequenceFromAttachments(context);
  }

  public replace(context: PiPromptContextAttachment[]): void {
    this.attachments = context.map((attachment) => ({ ...attachment }));
    this.syncSequenceFromAttachments(context);
  }

  private createAttachment(input: PiPromptContextInput): PiPromptContextAttachment[] {
    const path = input.path.trim();

    if (!path) {
      return [];
    }

    const kind = input.kind === 'selection' ? 'selection' : 'file';
    const label = (input.label ?? '').trim() || createPromptContextLabel(input, path);
    const title = (input.title ?? '').trim() || createPromptContextTitle(input, path);

    const note = normalizePromptContextNote(input.note);
    const source = normalizePromptContextSource(input.source);
    const traceOrigin = normalizeTraceOrigin(input.traceOrigin);

    if (kind === 'file') {
      return [{
        id: this.nextId(source),
        kind,
        path,
        label,
        title,
        ...(note ? { note } : {}),
        ...(source ? { source } : {}),
        ...(traceOrigin ? { traceOrigin } : {})
      }];
    }

    const text = typeof input.text === 'string' ? input.text : '';

    if (!text.trim()) {
      return [];
    }

    return [{
      id: this.nextId(source),
      kind,
      path,
      label,
      title,
      languageId: input.languageId,
      startLine: normalizeLineNumber(input.startLine),
      endLine: normalizeLineNumber(input.endLine),
      ...(note ? { note } : {}),
      ...(source ? { source } : {}),
      ...(traceOrigin ? { traceOrigin } : {}),
      text
    }];
  }

  private nextId(source: 'origin' | undefined): string {
    this.sequence += 1;
    return `${source ?? 'context'}-${this.sequence}`;
  }

  private syncSequenceFromAttachments(attachments: PiPromptContextAttachment[]): void {
    for (const attachment of attachments) {
      const match = attachment.id.match(/-(\d+)$/);

      if (!match) {
        continue;
      }

      const value = Number.parseInt(match[1], 10);

      if (Number.isFinite(value) && value > this.sequence) {
        this.sequence = value;
      }
    }
  }
}

function normalizeLineNumber(value: number | undefined): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : undefined;
}

function normalizePromptContextNote(value: string | undefined): string | undefined {
  const note = value?.trim();
  return note ? note : undefined;
}

function normalizePromptContextSource(value: string | undefined): 'origin' | undefined {
  return value === 'origin' ? value : undefined;
}

function normalizeTraceOrigin(value: PiPromptContextInput['traceOrigin']): PiPromptContextInput['traceOrigin'] {
  const historicalPath = value?.historicalPath?.trim();
  const currentRelativePath = value?.currentRelativePath?.trim();

  if (!historicalPath || !currentRelativePath) {
    return undefined;
  }

  return {
    historicalPath,
    currentRelativePath
  };
}

function createPromptContextLabel(input: PiPromptContextInput, path: string): string {
  return appendLineRange(getPathBasename(path), input);
}

function createPromptContextTitle(input: PiPromptContextInput, path: string): string {
  return appendLineRange(path, input);
}

function appendLineRange(label: string, input: PiPromptContextInput): string {
  if (input.kind !== 'selection') {
    return label;
  }

  const startLine = normalizeLineNumber(input.startLine);
  const endLine = normalizeLineNumber(input.endLine);

  if (startLine && endLine && endLine !== startLine) {
    return `${label}:${startLine}-${endLine}`;
  }

  if (startLine) {
    return `${label}:${startLine}`;
  }

  return label;
}

function getPathBasename(path: string): string {
  const normalizedPath = path.replace(/\\/g, '/');
  const lastSlashIndex = normalizedPath.lastIndexOf('/');
  return lastSlashIndex === -1 ? normalizedPath : normalizedPath.slice(lastSlashIndex + 1);
}
