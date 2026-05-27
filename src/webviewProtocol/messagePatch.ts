import type { ChatSnapshotMessage } from '../chat/chatSession';
import type { WebviewMessagePatch, WebviewStateMessage } from './types';

export type PostedWebviewMessageSync = {
  id: string;
  revision: number;
  imagesSignature: string;
  activityImageSignatures: Map<string, string>;
};

export type PostedWebviewChatSync = {
  generation: number;
  messages: PostedWebviewMessageSync[];
};

export type WebviewMessageSyncPlan = {
  includeMessages: boolean;
  messagePatch?: WebviewMessagePatch;
  postedSync: PostedWebviewChatSync;
};

type PatchImage = {
  type?: string;
  data?: string;
  mimeType?: string;
  alt?: string;
};

type PatchActivity = {
  id?: string;
  images?: PatchImage[];
};

type PatchableMessage = {
  id?: string;
  revision?: number;
  role: string;
  text: string;
  images?: PatchImage[];
  activities?: PatchActivity[];
};

export type WebviewStateMessageWithMessages = WebviewStateMessage & {
  messages: NonNullable<WebviewStateMessage['messages']>;
};

export function resolveWebviewStateMessageMessages(
  message: WebviewStateMessage,
  previous: WebviewStateMessage | undefined
): WebviewStateMessageWithMessages {
  if (message.messages) {
    return message as WebviewStateMessageWithMessages;
  }

  const previousMessages = previous?.messages ?? [];
  const messages = message.messagePatch
    ? applyWebviewMessagePatch(previousMessages, message.messagePatch)
    : previousMessages;

  return {
    ...message,
    messages
  };
}

export function parseWebviewMessagePatch(value: unknown): WebviewMessagePatch | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const upserts = Array.isArray(value.upserts)
    ? value.upserts.filter(isWebviewMessagePatchUpsert)
    : undefined;
  const deleteFrom = typeof value.deleteFrom === 'number' && Number.isInteger(value.deleteFrom) && value.deleteFrom >= 0
    ? value.deleteFrom
    : undefined;

  if ((!upserts || upserts.length === 0) && deleteFrom === undefined) {
    return undefined;
  }

  return {
    ...(upserts && upserts.length > 0 ? { upserts } : {}),
    ...(deleteFrom !== undefined ? { deleteFrom } : {})
  };
}

export function applyWebviewMessagePatch<TMessage extends PatchableMessage>(
  previousMessages: TMessage[],
  patch: WebviewMessagePatch
): Array<TMessage | ChatSnapshotMessage> {
  const messages: Array<TMessage | ChatSnapshotMessage> = previousMessages.slice();

  if (typeof patch.deleteFrom === 'number') {
    messages.splice(patch.deleteFrom);
  }

  for (const upsert of patch.upserts ?? []) {
    messages[upsert.index] = mergePatchedWebviewMessage(messages[upsert.index], upsert.message);
  }

  return messages;
}

export function createWebviewMessageSyncPlan(options: {
  generation: number;
  messages: ChatSnapshotMessage[];
  lastSync?: PostedWebviewChatSync;
}): WebviewMessageSyncPlan {
  const postedSync = createPostedWebviewChatSync(options.generation, options.messages);
  const lastSync = options.lastSync;

  if (!lastSync || lastSync.generation !== postedSync.generation) {
    return { includeMessages: true, postedSync };
  }

  const upserts: Array<{ index: number; message: ChatSnapshotMessage }> = [];
  const limit = options.messages.length;

  for (let index = 0; index < limit; index += 1) {
    const message = options.messages[index];
    const previous = lastSync.messages[index];

    if (!previous || previous.id !== message.id || previous.revision !== message.revision) {
      upserts.push({
        index,
        message: createPatchMessage(message, previous)
      });
    }
  }

  const deleteFrom = lastSync.messages.length > options.messages.length
    ? options.messages.length
    : undefined;

  if (upserts.length === 0 && deleteFrom === undefined) {
    return { includeMessages: false, postedSync };
  }

  return {
    includeMessages: false,
    messagePatch: {
      ...(upserts.length > 0 ? { upserts } : {}),
      ...(deleteFrom !== undefined ? { deleteFrom } : {})
    },
    postedSync
  };
}

export function createPostedWebviewChatSync(generation: number, messages: ChatSnapshotMessage[]): PostedWebviewChatSync {
  return {
    generation,
    messages: messages.map((message) => ({
      id: message.id,
      revision: message.revision,
      imagesSignature: getImagesSignature(message.images),
      activityImageSignatures: getActivityImageSignatures(message)
    }))
  };
}

function isWebviewMessagePatchUpsert(value: unknown): value is { index: number; message: ChatSnapshotMessage } {
  if (!isRecord(value)) {
    return false;
  }

  return typeof value.index === 'number'
    && Number.isInteger(value.index)
    && value.index >= 0
    && isRecord(value.message)
    && typeof value.message.role === 'string'
    && typeof value.message.text === 'string';
}

function mergePatchedWebviewMessage<TMessage extends PatchableMessage>(
  previous: TMessage | ChatSnapshotMessage | undefined,
  incoming: ChatSnapshotMessage
): TMessage | ChatSnapshotMessage {
  if (!previous || !incoming.id || previous.id !== incoming.id) {
    return incoming;
  }

  const merged: ChatSnapshotMessage = { ...incoming };

  if (!('images' in incoming) && previous.images) {
    merged.images = previous.images as ChatSnapshotMessage['images'];
  }

  if (Array.isArray(incoming.activities) && Array.isArray(previous.activities)) {
    merged.activities = incoming.activities.map((activity) => {
      const activityId = typeof activity.id === 'string' ? activity.id : '';
      const previousActivity = activityId
        ? previous.activities?.find((item) => item.id === activityId)
        : undefined;

      if (!previousActivity || 'images' in activity || !previousActivity.images) {
        return activity;
      }

      return { ...activity, images: previousActivity.images as typeof activity.images };
    });
  }

  return merged;
}

function createPatchMessage(message: ChatSnapshotMessage, previous: PostedWebviewMessageSync | undefined): ChatSnapshotMessage {
  if (!previous || previous.id !== message.id) {
    return message;
  }

  const next: ChatSnapshotMessage = { ...message };

  const imagesSignature = getImagesSignature(message.images);

  if (imagesSignature === previous.imagesSignature) {
    delete next.images;
  } else if (!Array.isArray(message.images) && previous.imagesSignature) {
    next.images = [];
  }

  if (Array.isArray(message.activities)) {
    next.activities = message.activities.map((activity) => {
      const activityId = typeof activity.id === 'string' ? activity.id : '';

      const activityImagesSignature = getImagesSignature(activity.images);
      const previousActivityImagesSignature = previous.activityImageSignatures.get(activityId);

      if (!activityId || activityImagesSignature !== previousActivityImagesSignature) {
        return !Array.isArray(activity.images) && previousActivityImagesSignature
          ? { ...activity, images: [] }
          : activity;
      }

      const nextActivity = { ...activity };
      delete nextActivity.images;
      return nextActivity;
    });
  }

  return next;
}

function getActivityImageSignatures(message: ChatSnapshotMessage): Map<string, string> {
  const signatures = new Map<string, string>();

  for (const activity of message.activities ?? []) {
    if (typeof activity.id === 'string') {
      signatures.set(activity.id, getImagesSignature(activity.images));
    }
  }

  return signatures;
}

function getImagesSignature(images: PatchImage[] | undefined): string {
  if (!Array.isArray(images) || images.length === 0) {
    return '';
  }

  return images.map((image) => {
    const data = typeof image.data === 'string' ? image.data : '';
    const prefix = data.slice(0, 32);
    const suffix = data.length > 32 ? data.slice(-32) : '';
    return [image.type ?? '', image.mimeType ?? '', image.alt ?? '', data.length, prefix, suffix].join('\u0000');
  }).join('\u0001');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
