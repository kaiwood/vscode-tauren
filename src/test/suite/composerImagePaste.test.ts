import * as assert from 'assert';
import { getPastedPromptImageFiles } from '../../webview/composer/composer';

suite('Composer image paste', () => {
  test('uses named clipboard files', () => {
    const image = createFile('diagram.png');

    assert.deepStrictEqual(getPastedPromptImageFiles(createDataTransfer([image])), [image]);
  });

  test('falls back to named clipboard file items', () => {
    const image = createFile('diagram.webp');

    assert.deepStrictEqual(getPastedPromptImageFiles(createDataTransfer([], [createFileItem(image)])), [image]);
  });

  test('ignores text paths and unnamed blobs', () => {
    const result = getPastedPromptImageFiles(createDataTransfer([], [
      createStringItem(),
      createFileItem(createFile(''))
    ]));

    assert.deepStrictEqual(result, []);
  });
});

function createFile(name: string): File {
  return { name, size: 1, type: 'image/png' } as File;
}

function createDataTransfer(files: File[] = [], items: DataTransferItem[] = []): DataTransfer {
  return { files, items } as unknown as DataTransfer;
}

function createFileItem(file: File): DataTransferItem {
  return {
    kind: 'file',
    type: file.type,
    getAsFile: () => file
  } as DataTransferItem;
}

function createStringItem(): DataTransferItem {
  return {
    kind: 'string',
    type: 'text/plain',
    getAsFile: () => null,
    getAsString: (callback: FunctionStringCallback | null) => callback?.('/tmp/diagram.png')
  } as DataTransferItem;
}
