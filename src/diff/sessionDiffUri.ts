import * as vscode from 'vscode';
import type { SessionDiffDocumentContext } from './types';

export const sessionDiffScheme = 'tauren-session-diff';

export function getSessionDiffDocumentContext(uri: vscode.Uri): SessionDiffDocumentContext | undefined {
  if (uri.scheme !== sessionDiffScheme || (uri.authority !== 'original' && uri.authority !== 'modified')) {
    return undefined;
  }

  const pathParts = uri.path.replace(/^\/+/, '').split('/').filter(Boolean);

  if (pathParts.length < 2) {
    return undefined;
  }

  return {
    path: pathParts.slice(1).join('/'),
    side: uri.authority
  };
}
