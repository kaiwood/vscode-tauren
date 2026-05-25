import * as path from 'node:path';
import { promises as fs } from 'node:fs';
import type { EditOperations, WriteOperations } from '@earendil-works/pi-coding-agent';
import type { PiSdkModule } from './piSdkLoader';

type GuardOptions = {
  workspaceRoot: string;
  shouldReject: () => boolean;
};

type SdkToolDefinition = NonNullable<Parameters<PiSdkModule['createAgentSessionFromServices']>[0]['customTools']>[number];

export function createWorkspaceMutationGuardTools(
  sdk: PiSdkModule,
  options: GuardOptions
): SdkToolDefinition[] {
  const editOperations: EditOperations = {
    readFile: async (absolutePath) => {
      await assertWorkspaceMutationAllowed(absolutePath, options, 'edit');
      return fs.readFile(absolutePath);
    },
    writeFile: async (absolutePath, content) => {
      await assertWorkspaceMutationAllowed(absolutePath, options, 'edit');
      await fs.writeFile(absolutePath, content, 'utf-8');
    },
    access: async (absolutePath) => {
      await assertWorkspaceMutationAllowed(absolutePath, options, 'edit');
      await fs.access(absolutePath);
    }
  };
  const writeOperations: WriteOperations = {
    mkdir: async (dir) => {
      await assertWorkspaceMutationAllowed(dir, options, 'write');
      await fs.mkdir(dir, { recursive: true });
    },
    writeFile: async (absolutePath, content) => {
      await assertWorkspaceMutationAllowed(absolutePath, options, 'write');
      await fs.writeFile(absolutePath, content, 'utf-8');
    }
  };

  return [
    sdk.createEditToolDefinition(options.workspaceRoot, { operations: editOperations }),
    sdk.createWriteToolDefinition(options.workspaceRoot, { operations: writeOperations })
  ] as unknown as SdkToolDefinition[];
}

export async function assertWorkspaceMutationAllowed(
  absolutePath: string,
  options: GuardOptions,
  toolName: 'edit' | 'write'
): Promise<void> {
  if (!options.shouldReject()) {
    return;
  }

  const workspaceRoot = await resolveExistingPath(options.workspaceRoot);
  const candidatePath = await resolvePathForContainment(absolutePath);

  if (isPathWithinOrSame(workspaceRoot, candidatePath)) {
    return;
  }

  throw new Error(
    `Tauren blocked ${toolName}: ${absolutePath} is outside the workspace (${options.workspaceRoot}). `
    + 'Disable tauren.rejectEditWriteOutsideWorkspace to allow this mutation.'
  );
}

async function resolvePathForContainment(filePath: string): Promise<string> {
  const resolved = path.resolve(filePath);

  try {
    return await fs.realpath(resolved);
  } catch {
    return resolveViaNearestExistingAncestor(resolved);
  }
}

async function resolveViaNearestExistingAncestor(filePath: string): Promise<string> {
  const parts: string[] = [];
  let current = filePath;

  for (;;) {
    try {
      const existing = await fs.realpath(current);
      return path.resolve(existing, ...parts.reverse());
    } catch {
      const parent = path.dirname(current);

      if (parent === current) {
        return filePath;
      }

      parts.push(path.basename(current));
      current = parent;
    }
  }
}

async function resolveExistingPath(filePath: string): Promise<string> {
  try {
    return await fs.realpath(path.resolve(filePath));
  } catch {
    return path.resolve(filePath);
  }
}

function isPathWithinOrSame(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === '' || (!!relative && !relative.startsWith('..') && !path.isAbsolute(relative));
}
