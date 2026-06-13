export type AgentMemoryRecord = {
  id?: string;
  text?: string;
  scope?: string;
  tags?: string[];
  active?: boolean;
  confidence?: number;
  createdAt?: string;
  updatedAt?: string;
};

export type AgentMemoryStatus = {
  enabled: boolean;
  autoSummary: boolean;
  paths?: {
    core?: string;
    soft?: string;
    events?: string;
  };
};

export type AgentMemoryList = {
  globalCore: AgentMemoryRecord[];
  workspaceCore: AgentMemoryRecord[];
  workspaceSoft: AgentMemoryRecord[];
};

export type AgentMemoryInspect = AgentMemoryStatus & {
  core: AgentMemoryRecord[];
  soft: AgentMemoryRecord[];
};

export type AgentMemoryWhy = {
  message?: string;
  explanation?: string;
  memories?: AgentMemoryRecord[];
};

export type AgentMemorySummarize = {
  memories: AgentMemoryRecord[];
};

export type AgentMemoryClient = {
  getMemoryStatus(): Promise<AgentMemoryStatus>;
  setMemoryEnabled(enabled: boolean): Promise<AgentMemoryStatus>;
  setMemoryAutoSummary(autoSummary: boolean): Promise<AgentMemoryStatus>;
  listMemory(options?: { includeInactive?: boolean }): Promise<AgentMemoryList>;
  addMemory(text: string, options?: { core?: boolean; scope?: string; tags?: string[] }): Promise<AgentMemoryRecord>;
  forgetMemory(id: string): Promise<boolean>;
  promoteMemory(id: string): Promise<AgentMemoryRecord>;
  relaxMemory(id: string): Promise<AgentMemoryRecord>;
  inspectMemory(): Promise<AgentMemoryInspect>;
  whyMemory(): Promise<AgentMemoryWhy>;
  summarizeMemory(): Promise<AgentMemorySummarize>;
};

export function isAgentMemoryClient(client: unknown): client is AgentMemoryClient {
  return !!client
    && typeof client === 'object'
    && typeof (client as Partial<AgentMemoryClient>).getMemoryStatus === 'function'
    && typeof (client as Partial<AgentMemoryClient>).setMemoryEnabled === 'function'
    && typeof (client as Partial<AgentMemoryClient>).listMemory === 'function'
    && typeof (client as Partial<AgentMemoryClient>).addMemory === 'function';
}
