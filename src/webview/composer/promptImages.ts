import {
  getPromptImageTooLargeMessage,
  getSupportedPromptImageMimeType,
  getUnsupportedPromptImageMessage,
  maxPromptImageBytes
} from '../../prompt/imageAttachments';

export type ComposerDragState = 'none' | 'neutral' | 'valid' | 'invalid';

export async function createDroppedPromptImagesMessage(dataTransfer: DataTransfer): Promise<unknown | undefined> {
  const files = Array.from(dataTransfer.files ?? []);
  const uris = files.length > 0 ? [] : getDroppedUriTexts(dataTransfer);

  if (files.length === 0 && uris.length === 0) {
    return undefined;
  }

  const rejections = getPromptImageFileRejections(files);

  if (rejections.length > 0) {
    return { type: 'dropPromptImages', files: [], uris: [], rejections };
  }

  return createPromptImagesMessageFromFiles(files, uris);
}

export async function createPromptImagesMessageFromFiles(files: readonly File[], uris: string[] = []): Promise<unknown | undefined> {
  const droppedFiles = [];

  for (const file of files) {
    try {
      droppedFiles.push({
        label: getPromptImageFileLabel(file),
        title: getPromptImageFileLabel(file),
        mimeType: getSupportedPromptImageMimeType(getPromptImageFileLabel(file)) ?? file.type,
        sizeBytes: file.size,
        data: await readFileAsBase64(file)
      });
    } catch {
      return {
        type: 'dropPromptImages',
        files: [],
        uris: [],
        rejections: [`Cannot read attachment: ${getPromptImageFileLabel(file)}.`]
      };
    }
  }

  return { type: 'dropPromptImages', files: droppedFiles, uris };
}

export function getPromptImageFileRejections(files: readonly File[]): string[] {
  const rejections: string[] = [];

  for (const file of files) {
    const label = getPromptImageFileLabel(file);

    if (!getSupportedPromptImageMimeType(label)) {
      rejections.push(getUnsupportedPromptImageMessage(label));
      continue;
    }

    if (file.size > maxPromptImageBytes) {
      rejections.push(getPromptImageTooLargeMessage(label));
    }
  }

  return rejections;
}

export function getPastedPromptImageFiles(dataTransfer: DataTransfer): File[] {
  const files = Array.from(dataTransfer.files ?? []).filter(hasClipboardFileName);

  if (files.length > 0) {
    return files;
  }

  return Array.from(dataTransfer.items ?? [])
    .filter((item) => item.kind === 'file')
    .map((item) => item.getAsFile())
    .filter((file): file is File => Boolean(file && hasClipboardFileName(file)));
}

export function classifyComposerDragState(dataTransfer: DataTransfer | null): ComposerDragState {
  if (!dataTransfer) {
    return 'neutral';
  }

  const files = Array.from(dataTransfer.files ?? []);

  if (files.length > 0) {
    return getPromptImageFileRejections(files).length > 0 ? 'invalid' : 'valid';
  }

  const itemStates = Array.from(dataTransfer.items ?? [])
    .filter((item) => item.kind === 'file')
    .map(classifyDataTransferFileItem);

  if (itemStates.includes('invalid')) {
    return 'invalid';
  }

  if (itemStates.length > 0 && itemStates.every((state) => state === 'valid')) {
    return 'valid';
  }

  return 'neutral';
}

function getPromptImageFileLabel(file: File): string {
  return file.name || 'dropped file';
}

function hasClipboardFileName(file: File): boolean {
  return typeof file.name === 'string' && file.name.length > 0;
}

function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.addEventListener('load', () => {
      resolve(typeof reader.result === 'string' ? stripDataUrlPrefix(reader.result) : '');
    });
    reader.addEventListener('error', () => reject(reader.error));
    reader.readAsDataURL(file);
  });
}

function stripDataUrlPrefix(value: string): string {
  const commaIndex = value.indexOf(',');
  return commaIndex >= 0 ? value.slice(commaIndex + 1) : value;
}

function classifyDataTransferFileItem(item: DataTransferItem): Exclude<ComposerDragState, 'none'> {
  const file = item.getAsFile();

  if (file?.name) {
    return getPromptImageFileRejections([file]).length > 0 ? 'invalid' : 'valid';
  }

  if (item.type) {
    return isSupportedPromptImageMimeType(item.type) ? 'valid' : 'invalid';
  }

  return 'neutral';
}

function isSupportedPromptImageMimeType(value: string): boolean {
  return value === 'image/png'
    || value === 'image/jpeg'
    || value === 'image/gif'
    || value === 'image/webp';
}

function getDroppedUriTexts(dataTransfer: DataTransfer): string[] {
  const uriList = parseDroppedUriText(dataTransfer.getData('text/uri-list'));

  if (uriList.length > 0) {
    return uriList;
  }

  return parseDroppedUriText(dataTransfer.getData('text/plain'));
}

function parseDroppedUriText(value: string): string[] {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'))
    .filter(isDroppedUriText);
}

function isDroppedUriText(value: string): boolean {
  return /^[a-zA-Z][a-zA-Z\d+.-]*:/.test(value)
    || value.startsWith('/')
    || /^[a-zA-Z]:[\\/]/.test(value)
    || value.startsWith('\\\\');
}
