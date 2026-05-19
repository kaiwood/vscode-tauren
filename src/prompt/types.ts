export type PiPromptContextKind = 'file' | 'selection';

export type PiPromptContextSource = 'origin';

export type PiPromptTraceOriginLinkedCommit = {
  sha: string;
  shortSha: string;
  subject: string;
  body?: string;
  authorDate?: string;
  commitDate?: string;
  touchedTracedPath: true;
  touchedPaths?: string[];
  relation: 'commit_touches_traced_path';
  confidence: 'high';
};

export type PiPromptTraceOriginData = {
  historicalPath: string;
  currentRelativePath: string;
  origin?: {
    sessionId?: string;
    toolName?: 'edit' | 'write';
    recordId?: string;
    matchedAt?: string;
    sessionEndedAt?: string;
  };
  git?: {
    traceLinkedCommit?: PiPromptTraceOriginLinkedCommit;
  };
};

export type PiPromptContextInput = {
  kind: PiPromptContextKind;
  path: string;
  label?: string;
  title?: string;
  languageId?: string;
  startLine?: number;
  endLine?: number;
  note?: string;
  text?: string;
  source?: PiPromptContextSource;
  traceOrigin?: PiPromptTraceOriginData;
};

export type PiPromptContextAttachment = PiPromptContextInput & {
  id: string;
  label: string;
  title: string;
};

export type PiPromptFormattingContextAttachment = Pick<
  PiPromptContextInput,
  'kind' | 'path' | 'languageId' | 'startLine' | 'endLine' | 'note' | 'text' | 'source' | 'traceOrigin'
>;
