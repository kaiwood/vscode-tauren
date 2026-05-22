export type MaybePromise<T> = T | PromiseLike<T>;

export type ExtensionUi = {
  notify(message: string, notifyType: string): void;
  select(title: string, options: string[]): MaybePromise<string | undefined>;
  confirm(title: string, message: string | undefined): MaybePromise<boolean | undefined>;
  input(title: string, placeholder: string | undefined): MaybePromise<string | undefined>;
};

export function createCancellingExtensionUi(
  notify: (message: string, notifyType: string) => void
): ExtensionUi {
  return {
    notify,
    select: async () => undefined,
    confirm: async () => undefined,
    input: async () => undefined
  };
}
