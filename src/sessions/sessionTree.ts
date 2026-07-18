import { resolve } from 'node:path';
import type { RawSessionInfo, SessionListItem } from './types';

type SessionTreeLayout = Pick<SessionListItem, 'depth' | 'isLast' | 'ancestorContinues' | 'current'>;

type SessionTreeNode<T extends RawSessionInfo> = {
  session: T;
  children: SessionTreeNode<T>[];
};

export function decorateSessionTree<T extends RawSessionInfo>(
  sessions: readonly T[],
  currentSessionFile: string | undefined
): Array<T & SessionTreeLayout> {
  const currentPath = canonicalizePath(currentSessionFile);

  return flattenSessionTree(buildSessionTree(sessions)).map((session) => ({
    ...session,
    current: currentPath !== undefined && canonicalizePath(session.path) === currentPath
  }));
}

function buildSessionTree<T extends RawSessionInfo>(sessions: readonly T[]): SessionTreeNode<T>[] {
  const byPath = new Map<string, SessionTreeNode<T>>();

  for (const session of sessions) {
    byPath.set(canonicalizePath(session.path) ?? session.path, { session, children: [] });
  }

  const parentPaths = new Map<string, string>();

  for (const session of sessions) {
    const sessionPath = canonicalizePath(session.path) ?? session.path;
    const parentPath = canonicalizePath(session.parentSessionPath);

    if (parentPath && parentPath !== sessionPath && byPath.has(parentPath)) {
      parentPaths.set(sessionPath, parentPath);
    }
  }

  const cyclicPaths = findCyclicSessionPaths(parentPaths);
  const roots: SessionTreeNode<T>[] = [];

  for (const session of sessions) {
    const sessionPath = canonicalizePath(session.path) ?? session.path;
    const node = byPath.get(sessionPath);

    if (!node) {
      continue;
    }

    const parentPath = parentPaths.get(sessionPath);

    if (parentPath && !cyclicPaths.has(sessionPath)) {
      byPath.get(parentPath)?.children.push(node);
    } else {
      roots.push(node);
    }
  }

  sortSessionTree(roots);
  return roots;
}

function findCyclicSessionPaths(parentPaths: ReadonlyMap<string, string>): Set<string> {
  const cyclicPaths = new Set<string>();
  const visited = new Set<string>();

  for (const startPath of parentPaths.keys()) {
    if (visited.has(startPath)) {
      continue;
    }

    const path: string[] = [];
    const positions = new Map<string, number>();
    let candidate: string | undefined = startPath;

    while (candidate && !visited.has(candidate)) {
      const cycleStart = positions.get(candidate);

      if (cycleStart !== undefined) {
        for (const pathEntry of path.slice(cycleStart)) {
          cyclicPaths.add(pathEntry);
        }
        break;
      }

      positions.set(candidate, path.length);
      path.push(candidate);
      candidate = parentPaths.get(candidate);
    }

    for (const pathEntry of path) {
      visited.add(pathEntry);
    }
  }

  return cyclicPaths;
}

function sortSessionTree<T extends RawSessionInfo>(nodes: SessionTreeNode<T>[]): void {
  nodes.sort((left, right) => Date.parse(right.session.modified) - Date.parse(left.session.modified));

  for (const node of nodes) {
    sortSessionTree(node.children);
  }
}

function flattenSessionTree<T extends RawSessionInfo>(roots: SessionTreeNode<T>[]): Array<T & Omit<SessionTreeLayout, 'current'>> {
  const result: Array<T & Omit<SessionTreeLayout, 'current'>> = [];

  const walk = (
    node: SessionTreeNode<T>,
    depth: number,
    ancestorContinues: boolean[],
    isLast: boolean
  ): void => {
    result.push({
      ...node.session,
      depth,
      isLast,
      ancestorContinues
    });

    node.children.forEach((child, index) => {
      walk(child, depth + 1, [...ancestorContinues, depth > 0 ? !isLast : false], index === node.children.length - 1);
    });
  };

  roots.forEach((root, index) => {
    walk(root, 0, [], index === roots.length - 1);
  });

  return result;
}

function canonicalizePath(path: string | undefined): string | undefined {
  return path ? resolve(path) : undefined;
}
