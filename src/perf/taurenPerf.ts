export type TaurenPerfEventName =
  | 'lane.switch'
  | 'session.switch'
  | 'transcript.render'
  | 'sessionList.render'
  | 'tree.render'
  | 'sessionList.load';

export type TaurenPerfEventDetails = Record<string, string | number | boolean | undefined>;

export type TaurenPerfEvent = {
  name: TaurenPerfEventName;
  timestamp: string;
  durationMs: number;
  details: TaurenPerfEventDetails;
};

export type TaurenPerfTimer = {
  name: TaurenPerfEventName;
  startedAt: number;
  details: TaurenPerfEventDetails;
};

type TaurenPerfRecorderOptions = {
  isEnabled: () => boolean;
  writeLine: (line: string) => void;
  now?: () => number;
  timestamp?: () => string;
  maxEvents?: number;
};

const defaultMaxEvents = 100;

export class TaurenPerfRecorder {
  private readonly events: TaurenPerfEvent[] = [];

  public constructor(private readonly options: TaurenPerfRecorderOptions) {}

  public get enabled(): boolean {
    return this.options.isEnabled();
  }

  public start(name: TaurenPerfEventName, details: TaurenPerfEventDetails = {}): TaurenPerfTimer | undefined {
    if (!this.enabled) {
      return undefined;
    }

    return {
      name,
      startedAt: this.now(),
      details: sanitizeDetails(details)
    };
  }

  public finish(timer: TaurenPerfTimer | undefined, details: TaurenPerfEventDetails = {}): void {
    if (!timer || !this.enabled) {
      return;
    }

    this.record(timer.name, this.now() - timer.startedAt, {
      ...timer.details,
      ...details
    });
  }

  public record(name: TaurenPerfEventName, durationMs: number, details: TaurenPerfEventDetails = {}): void {
    if (!this.enabled) {
      return;
    }

    const event: TaurenPerfEvent = {
      name,
      timestamp: this.timestamp(),
      durationMs: roundDuration(durationMs),
      details: sanitizeDetails(details)
    };

    this.events.push(event);

    const maxEvents = this.options.maxEvents ?? defaultMaxEvents;
    if (this.events.length > maxEvents) {
      this.events.splice(0, this.events.length - maxEvents);
    }

    this.options.writeLine(formatPerfEvent(event));
  }

  public getEvents(): TaurenPerfEvent[] {
    return this.events.map((event) => ({
      ...event,
      details: { ...event.details }
    }));
  }

  public formatDiagnostics(): string {
    const lines = ['Tauren diagnostics', ''];

    if (!this.enabled) {
      lines.push('Performance logging is disabled. Enable tauren.debugPerformance to collect new events.', '');
    }

    if (this.events.length === 0) {
      lines.push('No performance events recorded.');
      return lines.join('\n');
    }

    lines.push('Recent performance events', '');
    lines.push('Time                  Event                 Duration  Details');
    lines.push('--------------------  --------------------  --------  -------');

    for (const event of this.events) {
      const time = event.timestamp.replace('T', ' ').replace(/\.\d{3}Z$/, 'Z');
      lines.push([
        padRight(time, 20),
        padRight(event.name, 20),
        padLeft(formatDuration(event.durationMs), 8),
        formatDetails(event.details)
      ].join('  '));
    }

    return lines.join('\n');
  }

  private now(): number {
    return this.options.now?.() ?? performance.now();
  }

  private timestamp(): string {
    return this.options.timestamp?.() ?? new Date().toISOString();
  }
}

function formatPerfEvent(event: TaurenPerfEvent): string {
  const details = formatDetails(event.details);
  return `[Tauren perf] ${event.name} durationMs=${formatDuration(event.durationMs)} timestamp=${JSON.stringify(event.timestamp)}${details ? ' ' + details : ''}`;
}

function sanitizeDetails(details: TaurenPerfEventDetails): TaurenPerfEventDetails {
  const sanitized: TaurenPerfEventDetails = {};

  for (const [key, value] of Object.entries(details)) {
    if (value === undefined) {
      continue;
    }

    if (typeof value === 'number' && !Number.isFinite(value)) {
      continue;
    }

    sanitized[key] = value;
  }

  return sanitized;
}

function formatDetails(details: TaurenPerfEventDetails): string {
  return Object.entries(details)
    .map(([key, value]) => `${key}=${formatDetailValue(value)}`)
    .join(' ');
}

function formatDetailValue(value: string | number | boolean | undefined): string {
  if (typeof value === 'string') {
    return JSON.stringify(value);
  }

  return String(value);
}

function roundDuration(value: number): number {
  return Math.round(value * 10) / 10;
}

function formatDuration(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function padRight(value: string, length: number): string {
  return value.length >= length ? value : value + ' '.repeat(length - value.length);
}

function padLeft(value: string, length: number): string {
  return value.length >= length ? value : ' '.repeat(length - value.length) + value;
}
