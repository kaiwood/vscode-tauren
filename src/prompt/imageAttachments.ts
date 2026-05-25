export const maxPromptImageBytes = 10 * 1024 * 1024;
export const supportedPromptImageExtensions = ['png', 'jpg', 'jpeg', 'gif', 'webp'];

export function getSupportedPromptImageMimeType(filePath: string): string | undefined {
  const extension = getLowercaseExtension(filePath);

  if (extension === '.png') {
    return 'image/png';
  }

  if (extension === '.jpg' || extension === '.jpeg') {
    return 'image/jpeg';
  }

  if (extension === '.gif') {
    return 'image/gif';
  }

  if (extension === '.webp') {
    return 'image/webp';
  }

  return undefined;
}

export function getUnsupportedPromptImageMessage(label: string): string {
  return `Unsupported attachment: ${label}. Tauren currently supports PNG, JPEG, GIF, and WebP images.`;
}

export function getPromptImageTooLargeMessage(label: string): string {
  return `Image too large: ${label} exceeds 10MB.`;
}

function getLowercaseExtension(filePath: string): string {
  const normalized = filePath.split(/[\\/]/).pop() ?? filePath;
  const dotIndex = normalized.lastIndexOf('.');

  return dotIndex >= 0 ? normalized.slice(dotIndex).toLowerCase() : '';
}
