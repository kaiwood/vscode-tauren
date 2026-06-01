import type { WebviewExtensionRenderBlock } from './types';

export function hasWebviewExtensionImageBlock(blocks: readonly WebviewExtensionRenderBlock[]): boolean {
  return blocks.some((block) => block.type === 'image');
}

export function cloneWebviewExtensionRenderBlocks(blocks: readonly WebviewExtensionRenderBlock[]): WebviewExtensionRenderBlock[] {
  return blocks.map(cloneWebviewExtensionRenderBlock);
}

function cloneWebviewExtensionRenderBlock(block: WebviewExtensionRenderBlock): WebviewExtensionRenderBlock {
  return block.type === 'text'
    ? { type: 'text', lines: block.lines.slice() }
    : { ...block };
}
