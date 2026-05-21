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
  depth: number;
  isLast: boolean;
  ancestorContinues: boolean[];
  current: boolean;
};

export type ListPiSessionsOptions = {
  cwd?: string;
  sessionDir?: string;
  currentSessionFile?: string;
  env?: NodeJS.ProcessEnv;
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
  role: string;
  text: string;
  current: boolean;
  depth?: number;
  isLast?: boolean;
  ancestorContinues?: boolean[];
  activePath?: boolean;
  label?: string;
  prefix?: string;
};

export type RawEntry = Record<string, unknown> & {
  id?: string;
  parentId?: string | null;
  type?: string;
};

export type TreeNode = {
  entry: RawEntry;
  children: TreeNode[];
};
