export type PiSessionListItem = {
  path: string;
  id: string;
  cwd: string;
  name?: string;
  parentSessionPath?: string;
  created: string;
  modified: string;
  messageCount: number;
  firstMessage: string;
  metadataState?: 'loading' | 'ready';
  depth: number;
  isLast: boolean;
  ancestorContinues: boolean[];
  current: boolean;
};

export type SessionListLoadMetrics = {
  sessionCount: number;
  totalBytes: number;
  cacheHits: number;
  cacheMisses: number;
};

export type SessionListPreviousItem = Pick<
  PiSessionListItem,
  'path' | 'id' | 'cwd' | 'name' | 'parentSessionPath' | 'created' | 'modified' | 'messageCount' | 'firstMessage'
>;

export type ListPiSessionsOptions = {
  cwd?: string;
  sessionDir?: string;
  currentSessionFile?: string;
  env?: NodeJS.ProcessEnv;
  sessionMetadataCacheFile?: string;
  onProgress?: (sessions: PiSessionListItem[]) => void;
  onMetrics?: (metrics: SessionListLoadMetrics) => void;
  previousSessions?: readonly SessionListPreviousItem[];
};

export type PiSessionCandidate = {
  path: string;
  id?: string;
  cwd?: string;
  mtimeMs: number;
  size: number;
};

export type RawSessionInfo = Omit<PiSessionListItem, 'depth' | 'isLast' | 'ancestorContinues' | 'current'>;

export type SessionTreeNode = {
  session: RawSessionInfo;
  children: SessionTreeNode[];
};

export type PiSessionTreeItem = {
  entryId: string;
  parentId?: string;
  role: string;
  text: string;
  current: boolean;
  depth?: number;
  isLast?: boolean;
  ancestorContinues?: boolean[];
  activePath?: boolean;
  selectable?: boolean;
  label?: string;
  labelTimestamp?: string;
  prefix?: string;
};

export type RawEntry = Record<string, unknown> & {
  id?: string;
  parentId?: string | null;
  type?: string;
  resolvedLabel?: string;
};
