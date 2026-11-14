import type { ExtensionUIContext, ExtensionUIDialogOptions, TerminalInputHandler, Theme } from '@earendil-works/pi-coding-agent';
import { CancellationTokenSource, ErrorCodes, ResponseError, type MessageConnection, type NotificationType, type RequestType, type Disposable } from 'vscode-jsonrpc';
import { Notifications, UiRequests, type Snapshot } from '../protocol/index.js';
import { createOverlayHandle, createTuiFacade, isKeyRelease, setComponentFocused, taurenKeybindings, taurenTheme, type CustomUiComponent, type CustomUiTerminal } from '@tauren/shared/extensionUi/facades';
import { RemoteFooterData } from './footerData.js';
import { renderComponentContent } from '@tauren/shared/rendering/renderContent';

export interface RemoteExtensionUiOptions {
  autocompleteRegistry: { add(factory: Parameters<ExtensionUIContext['addAutocompleteProvider']>[0]): void };
  getCwd(): string;
  getAvailableProviderCount?(): number;
  diagnostic(message: string): void;
}
type Surface = {
  id: string;
  terminal: CustomUiTerminal;
  component?: CustomUiComponent;
  cleanup?: () => void;
  finish?: (value?: unknown) => void;
  cancelRequest?: () => void;
  hidden: boolean;
  attached: boolean;
  focused: boolean;
};

/** Reject malformed host payloads without echoing extension or user data. */
function invalid(): never { throw new ResponseError(ErrorCodes.InvalidParams, 'Invalid extension UI parameters'); }
/** RequestType is compile-time only; enforce the allowed wire fields here. */
function record(value: unknown, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !keys.includes(key))) invalid();
  return value as Record<string, unknown>;
}
/** Validate strings without trimming meaningful terminal input or surface IDs. */
function text(value: unknown): string { if (typeof value !== 'string') invalid(); return value; }
/** Reject unusable dimensions and bound valid sizes before calling extension code. */
function dimension(value: unknown, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) invalid();
  return Math.max(min, Math.min(max, Math.floor(value)));
}

/** SDK factories and done(T) never cross JSON-RPC. Only surface IDs, render lines,
 * and input travel to the host; arbitrary custom results remain server-local.
 */
export class RemoteExtensionUi {
  readonly context: ExtensionUIContext;
  readonly capabilityMethods: string[] = [...new Set([...Object.values(UiRequests).map(method => method.method), 'ui.setSurfaceState'])];
  private readonly registrations: Disposable[] = [];
  private readonly pending = new Set<() => void>();
  private readonly surfaces = new Map<string, Surface>();
  private readonly widgets = new Map<string, string | undefined>();
  private readonly statuses = new Map<string, string>();
  private readonly terminalHandlers = new Set<TerminalInputHandler>();
  private nextId = 1;
  private customId?: string;
  private footerId?: string;
  private editorText = '';
  private toolsExpanded = false;
  private disposed = false;
  private resetting = false;

  /** Build Pi's ExtensionUIContext and register the host-to-server half of the
   * bridge. Extension calls below send UI intent outward; request handlers below
   * operate on the actual components and callbacks retained in this process.
   */
  constructor(private readonly connection: MessageConnection, private readonly options: RemoteExtensionUiOptions) {
    this.context = {
      // Reverse dialogs return SDK dismissal values, not transport-specific nulls.
      // A selected value must belong to the choices originally supplied by Pi.
      select: (title, choices, opts) => this.dialog(UiRequests.select, { title, options: choices, ...this.timeoutParams(opts) }, opts,
        value => typeof value === 'string' && choices.includes(value) ? value : undefined),
      // Dismissal, cancellation and invalid host results all mean false to Pi.
      confirm: async (title, message, opts) => (await this.dialog(UiRequests.confirm, { title, message, ...this.timeoutParams(opts) }, opts,
        value => value === true)) === true,
      // Input/editor text is returned unchanged; only non-string results dismiss.
      input: (title, placeholder, opts) => this.dialog(UiRequests.input, { title, ...(placeholder === undefined ? {} : { placeholder }), ...this.timeoutParams(opts) }, opts,
        value => typeof value === 'string' ? value : undefined),
      // Pi's editor API has no dialog options; lifecycle reset still cancels it.
      editor: (title, prefill) => this.dialog(UiRequests.editor, { title, ...(prefill === undefined ? {} : { prefill }) }, undefined,
        value => typeof value === 'string' ? value : undefined),
      // Toast intent needs no reply and never becomes protocol stdout logging.
      notify: (message, type = 'info') => this.notify(Notifications.notify, { message, notifyType: type }),
      // Keep executable interceptors local and tell the host when forwarding is
      // needed. The returned disposer changes the subscription, not the runtime.
      onTerminalInput: handler => {
        if (!this.available) return () => {};
        this.terminalHandlers.add(handler);
        this.notify(Notifications.terminalInputSubscription, { enabled: true });
        return () => {
          this.terminalHandlers.delete(handler);
          this.notify(Notifications.terminalInputSubscription, { enabled: this.terminalHandlers.size > 0 });
        };
      },
      // Mirror status text for footer data as well as host display; undefined
      // clears an SDK status and is encoded explicitly as null on the wire.
      setStatus: (key, value) => {
        if (!this.available) return;
        if (value === undefined) this.statuses.delete(key); else this.statuses.set(key, value);
        this.notify(Notifications.status, { key, text: value ?? null });
        if (this.footerId) this.invalidate(this.footerId);
      },
      // Factories stay local; helpers publish strings or opaque surface handles.
      setWidget: (key, content, opts) => this.setWidget(key, content, opts),
      // The footer factory receives sandbox-local branch/status data.
      setFooter: factory => this.setFooter(factory),
      // Resolve done(T) beside Pi; never serialize arbitrary extension results.
      custom: (factory, opts) => this.custom(factory, opts),
      // Composer mutations are one-way host intent, not a remote editor model.
      pasteToEditor: value => { if (this.available) { this.editorText += value; this.notify(Notifications.pasteToEditor, { text: value }); } },
      // Replace the host Composer contents without transferring an editor object.
      setEditorText: value => { if (this.available) { this.editorText = value; this.notify(Notifications.setEditorText, { text: value }); } },
      // Match the in-process Tauren bridge: host composer contents are not read back.
      getEditorText: () => '',
      // Register the real provider wrapper beside Pi; the completion registry
      // exports suggestions/opaque handles, never this executable factory.
      addAutocompleteProvider: factory => { if (this.available) this.options.autocompleteRegistry.add(factory); },
      // Maintain the host's last reported expansion state for SDK renderers.
      getToolsExpanded: () => this.getToolsExpanded(),
      // Extension changes update local state immediately and request host display.
      setToolsExpanded: expanded => { if (this.available) { this.toolsExpanded = expanded; this.notify(Notifications.setToolsExpanded, { expanded }); } },
      // Match the current Tauren bridge: terminal-only presentation/editor APIs
      // and theme discovery/replacement are deliberately unsupported.
      setWorkingMessage() {}, setWorkingVisible() {}, setWorkingIndicator() {}, setHiddenThinkingLabel() {},
      setHeader() {}, setTitle() {}, setEditorComponent() {}, getEditorComponent: () => undefined,
      theme: {} as Theme, getAllThemes: () => [], getTheme: () => undefined,
      setTheme: () => ({ success: false, error: 'Theme switching is not supported in Tauren' })
    };
    this.registrations.push(
      // ui.render: the host supplies layout dimensions; invoke the local Pi
      // component and return text/image blocks, not the component or HTML.
      connection.onRequest(UiRequests.render, input => {
        const p = record(input, ['surfaceId', 'width', 'height', 'cellWidth', 'cellHeight']);
        const id = text(p.surfaceId);
        const columns = dimension(p.width, 20, 240), rows = dimension(p.height, 1, 80);
        const widthPx = p.cellWidth === undefined ? 9 : dimension(p.cellWidth, 1, 512);
        const heightPx = p.cellHeight === undefined ? 18 : dimension(p.cellHeight, 1, 512);
        const surface = this.surfaces.get(id);
        if (!surface || !surface.component || surface.hidden || !surface.attached) return { lines: [], blocks: [] };
        Object.assign(surface.terminal, { columns, rows, widthPx, heightPx });
        try {
          // Use the same image-aware traversal as transcript rendering. Components
          // remain server-local; normalized text/image blocks are the wire boundary.
          return renderComponentContent(surface.component, columns, surface.terminal);
        } catch { this.failSurface(surface, 'Extension UI render failed'); return { lines: [] }; }
      }),
      // ui.setSurfaceState: detaching or unfocusing is reversible, unlike dispose.
      // A component receives focus only when visible, attached and host-focused.
      connection.onRequest(UiRequests.setSurfaceState, (input: unknown) => {
        const p = record(input, ['surfaceId', 'attached', 'focused']);
        const id = text(p.surfaceId);
        if (typeof p.attached !== 'boolean' || typeof p.focused !== 'boolean') invalid();
        const surface = this.surfaces.get(id);
        if (surface) {
          surface.attached = p.attached;
          surface.focused = p.focused;
          try {
            if (surface.component) setComponentFocused(surface.component, surface.attached && surface.focused && !surface.hidden);
            if (surface.attached) this.invalidate(id);
          } catch { this.failSurface(surface, 'Extension UI focus update failed'); }
        }
        return null;
      }),
      // ui.surfaceInput: route input only to an eligible local component. Ignore
      // stale handles and key-release sequences unless the component opts in.
      connection.onRequest(UiRequests.surfaceInput, input => {
        const p = record(input, ['surfaceId', 'input']);
        const surface = this.surfaces.get(text(p.surfaceId)), data = text(p.input);
        if (surface?.component && surface.attached && !surface.hidden && surface.focused && (!isKeyRelease(data) || surface.component.wantsKeyRelease)) {
          try { surface.component.handleInput?.(data); this.invalidate(surface.id); }
          catch { this.failSurface(surface, 'Extension UI input failed'); }
        }
        return null;
      }),
      // ui.dispose: host dismissal releases component resources and settles any
      // custom() waiter. Repeated disposal of a stale ID is intentionally harmless.
      connection.onRequest(UiRequests.dispose, input => {
        const p = record(input, ['surfaceId']);
        this.removeSurface(text(p.surfaceId));
        return null;
      }),
      // ui.terminalInput: Pi interceptors run synchronously in registration order.
      // Transformations feed the next handler; consume short-circuits host input.
      connection.onRequest(UiRequests.terminalInput, input => {
        const p = record(input, ['input']);
        let data = text(p.input);
        for (const handler of [...this.terminalHandlers]) {
          if (!this.terminalHandlers.has(handler)) continue;
          try {
            const result = handler(data);
            if (result?.consume) return { consume: true };
            if (typeof result?.data === 'string') data = result.data;
          } catch { this.diagnostic('Extension terminal input handler failed'); }
        }
        return { consume: false, input: data };
      }),
      // Host expansion changes affect later Pi tool rendering; no reply is needed.
      connection.onNotification(Notifications.toolsExpanded, input => {
        try {
          const p = record(input, ['expanded']);
          if (typeof p.expanded !== 'boolean') invalid();
          this.toolsExpanded = p.expanded;
        } catch { this.diagnostic('Invalid tools expansion notification'); }
      }),
      // A broken pipe must release SDK waiters even without an explicit shutdown.
      connection.onClose(() => this.dispose()), connection.onDispose(() => this.dispose())
    );
  }

  /** Read the shared expansion state used by Pi's UI context and tool renderer. */
  getToolsExpanded(): boolean { return this.toolsExpanded; }
  /** Fence new extension-owned work during teardown and after disconnect. */
  private get available(): boolean { return !this.disposed && !this.resetting; }
  /** Isolate diagnostic failures so they cannot interrupt resource cleanup. */
  private diagnostic(message: string): void { try { this.options.diagnostic(message); } catch { /* Diagnostics must not break cancellation. */ } }
  /** Deliver one-way host intent; connection failure is diagnostic, not an
   * unhandled rejection from an otherwise synchronous Pi UI method.
   */
  private notify<P>(method: NotificationType<P>, params: P): void {
    if (this.disposed) return;
    try { void this.connection.sendNotification(method, params).catch(() => this.diagnostic('Extension UI notification delivery failed')); }
    catch { this.diagnostic('Extension UI notification delivery failed'); }
  }
  /** Project SDK timeout options onto JSON; AbortSignals remain server-local. */
  private timeoutParams(opts?: ExtensionUIDialogOptions): { timeoutMs?: number } {
    return opts?.timeout !== undefined && Number.isFinite(opts.timeout) && opts.timeout >= 0 ? { timeoutMs: opts.timeout } : {};
  }
  /** Own one reverse request until response, timeout, SDK abort or lifecycle reset.
   * Decode host results into SDK values, settle once, and remove every timer and
   * signal listener. Local dismissal also cancels the host's outstanding request.
   */
  private dialog<P, R, T>(method: RequestType<P, R, void>, params: P, opts: ExtensionUIDialogOptions | undefined,
    decode: (value: unknown) => T | undefined, installCancel?: (cancel: () => void) => void): Promise<T | undefined> {
    if (!this.available || opts?.signal?.aborted) return Promise.resolve(undefined);
    return new Promise(resolve => {
      const source = new CancellationTokenSource();
      let settled = false;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const finish = (value?: T, cancel = true) => {
        if (settled) return;
        settled = true;
        this.pending.delete(abort);
        if (timer !== undefined) clearTimeout(timer);
        opts?.signal?.removeEventListener('abort', abort);
        if (cancel) source.cancel(); // vscode-jsonrpc emits $/cancelRequest for the host dialog.
        source.dispose();
        resolve(value);
      };
      const abort = () => finish();
      this.pending.add(abort);
      installCancel?.(abort);
      opts?.signal?.addEventListener('abort', abort, { once: true });
      if (opts?.signal?.aborted) { abort(); return; }
      const timeout = this.timeoutParams(opts).timeoutMs;
      if (timeout !== undefined) timer = setTimeout(abort, Math.min(timeout, 2_147_483_647));
      try {
        void this.connection.sendRequest(method, params, source.token).then(value => {
          if (!settled) finish(decode(value), false);
        }, () => { if (!settled) { this.diagnostic('Extension UI host request failed'); finish(undefined, false); } });
      } catch { this.diagnostic('Extension UI host request failed'); finish(); }
    });
  }

  /** Allocate a connection-local handle before invoking a possibly async factory.
   * IDs are never reused, so late results cannot attach to a replacement surface.
   */
  private newSurface(): Surface {
    const surface: Surface = { id: `remote-ui-${this.nextId++}`, terminal: { columns: 80, rows: 12, widthPx: 9, heightPx: 18 }, hidden: false, attached: true, focused: false };
    this.surfaces.set(surface.id, surface);
    return surface;
  }
  /** Request a host redraw; actual rendering waits for host layout dimensions. */
  private invalidate(id: string): void { if (this.surfaces.has(id)) this.notify(Notifications.invalidate, { surfaceId: id }); }
  /** Release extension-owned focus/resources without letting its cleanup throw. */
  private disposeComponent(component?: CustomUiComponent): void {
    try { if (component) setComponentFocused(component, false); } catch { this.diagnostic('Extension UI focus cleanup failed'); }
    try { component?.dispose?.(); } catch { this.diagnostic('Extension UI component disposal failed'); }
  }
  /** Forget ownership before callbacks can reenter; clear host references, settle
   * custom results, cancel reverse requests, and dispose the component once.
   */
  private removeSurface(id: string): void {
    const surface = this.surfaces.get(id);
    if (!surface) return;
    this.surfaces.delete(id); // Remove before invoking extension code (which may reenter).
    if (this.customId === id) this.customId = undefined;
    if (this.footerId === id) { this.footerId = undefined; this.notify(Notifications.footer, { surfaceId: null }); }
    for (const [key, widgetId] of this.widgets) if (widgetId === id) {
      this.widgets.delete(key);
      this.notify(Notifications.widget, { key, placement: 'aboveEditor', content: null });
    }
    surface.cleanup?.();
    surface.finish?.();
    surface.cancelRequest?.();
    this.disposeComponent(surface.component);
  }
  /** Fail only this surface; other extensions and the protocol remain usable. */
  private failSurface(surface: Surface, message: string): void { this.diagnostic(message); this.removeSurface(surface.id); }
  /** Execute a Pi factory locally. If reset/dismissal wins the await, dispose its
   * late component rather than resurrecting UI owned by an invalidated session.
   */
  private async mount(surface: Surface, factory: () => unknown): Promise<boolean> {
    try {
      if (!this.surfaces.has(surface.id)) return false;
      const component = await factory() as CustomUiComponent;
      if (!this.surfaces.has(surface.id)) { this.disposeComponent(component); return false; }
      if (!component || typeof component.render !== 'function') throw new Error();
      surface.component = component;
      setComponentFocused(component, surface.attached && surface.focused && !surface.hidden);
      this.invalidate(surface.id);
      return true;
    } catch { this.failSurface(surface, 'Extension UI factory failed'); return false; }
  }

  /** Host one SDK custom() interaction. The factory receives Tauren's TUI/theme/
   * keybinding facades; done(T) resolves locally, while the reverse ui.custom
   * request represents only host visibility/dismissal. Synchronous done() before
   * mount and later host cancellation converge on the same surface cleanup.
   */
  private custom<T>(factory: (tui: never, theme: never, keybindings: never, done: (value: T) => void) => unknown,
    opts?: Parameters<ExtensionUIContext['custom']>[1]): Promise<T> {
    if (!this.available) return Promise.resolve(undefined as T);
    if (this.customId) this.removeSurface(this.customId);
    const surface = this.newSurface();
    this.customId = surface.id;
    surface.focused = true;
    return new Promise<T>(resolve => {
      let finished = false;
      surface.finish = value => { if (!finished) { finished = true; resolve(value as T); } };
      const done = (value: T) => { surface.finish?.(value); this.removeSurface(surface.id); };
      const tui = createTuiFacade(surface.terminal, () => this.invalidate(surface.id));
      void this.mount(surface, () => factory(tui as never, taurenTheme as never, taurenKeybindings as never, done)).then(mounted => {
        if (!mounted || !this.surfaces.has(surface.id)) return;
        const options: Snapshot = { overlay: opts?.overlay === true };
        // Overlay positioning is host-owned; never serialize callbacks or SDK objects.
        const request = this.dialog(UiRequests.custom, { surfaceId: surface.id, options }, undefined, () => undefined,
          cancel => { surface.cancelRequest = cancel; });
        void request.then(() => this.removeSurface(surface.id)); // null response means host dismissal, not done(T).
        try {
          const handle = createOverlayHandle(() => this.removeSurface(surface.id));
          opts?.onHandle?.({ ...handle,
            setHidden: hidden => { surface.hidden = hidden; handle.setHidden(hidden); if (surface.component) setComponentFocused(surface.component, surface.attached && surface.focused && !hidden); this.invalidate(surface.id); },
            focus: () => { surface.focused = true; handle.focus(); if (surface.component) setComponentFocused(surface.component, surface.attached && !surface.hidden); },
            unfocus: () => { surface.focused = false; handle.unfocus(); if (surface.component) setComponentFocused(surface.component, false); }
          });
        } catch { this.failSurface(surface, 'Extension UI overlay callback failed'); }
      });
    });
  }

  /** Replace a keyed SDK widget: text travels directly, but a factory creates a
   * local renderable surface. Replacement also releases any previous component.
   */
  private setWidget(key: string, content: string[] | ((tui: never, theme: never) => unknown) | undefined,
    opts?: { placement?: 'aboveEditor' | 'belowEditor' }): void {
    if (!this.available || !key.trim()) return;
    key = key.trim();
    const old = this.widgets.get(key);
    if (old) this.removeSurface(old);
    this.widgets.delete(key);
    const placement = opts?.placement === 'belowEditor' ? 'belowEditor' : 'aboveEditor';
    if (content === undefined || Array.isArray(content)) {
      if (content) this.widgets.set(key, undefined);
      this.notify(Notifications.widget, { key, placement, content: content ?? null });
      return;
    }
    const surface = this.newSurface();
    surface.terminal.rows = 4;
    this.widgets.set(key, surface.id);
    const tui = createTuiFacade(surface.terminal, () => this.invalidate(surface.id));
    this.notify(Notifications.widget, { key, placement, content: { surfaceId: surface.id } });
    void this.mount(surface, () => content(tui as never, taurenTheme as never));
  }
  /** Replace Pi's footer with a local component and read-only footer data provider.
   * The surface owns branch polling/subscriptions and releases them on removal.
   */
  private setFooter(factory: Parameters<ExtensionUIContext['setFooter']>[0]): void {
    if (!this.available) return;
    if (this.footerId) this.removeSurface(this.footerId);
    if (!factory) { this.notify(Notifications.footer, { surfaceId: null }); return; }
    const surface = this.newSurface();
    surface.terminal.rows = 1;
    this.footerId = surface.id;
    const data = new RemoteFooterData({ ...this.options, getStatuses: () => this.statuses, changed: () => this.invalidate(surface.id) });
    surface.cleanup = () => data.dispose();
    const tui = createTuiFacade(surface.terminal, () => this.invalidate(surface.id));
    this.notify(Notifications.footer, { surfaceId: surface.id });
    void this.mount(surface, () => factory(tui as never, taurenTheme as never, data));
  }

  /** Cancel blocking SDK interactions without clearing installed providers/widgets. */
  cancelInteractions(): void {
    for (const cancel of [...this.pending]) cancel();
    if (this.customId) this.removeSurface(this.customId);
  }

  /** Synchronous teardown also fences unresolved asynchronous factories. IDs are
   * never reused, so their late results can only be disposed, never remounted. */
  reset(): void {
    if (this.resetting) return;
    this.resetting = true;
    try {
      for (const cancel of [...this.pending]) cancel();
      this.terminalHandlers.clear();
      for (const id of [...this.surfaces.keys()]) this.removeSurface(id);
      this.widgets.clear(); this.statuses.clear();
      this.editorText = ''; this.toolsExpanded = false;
      this.notify(Notifications.clearStatuses, null);
      this.notify(Notifications.clearWidgets, null);
      this.notify(Notifications.footer, { surfaceId: null });
      this.notify(Notifications.terminalInputSubscription, { enabled: false });
    } finally { this.resetting = false; }
  }
  /** Final connection teardown: settle UI first, then unregister wire handlers.
   * Unlike reset(), this permanently rejects new extension-owned UI work.
   */
  dispose(): void {
    if (this.disposed) return;
    this.reset();
    this.disposed = true;
    for (const registration of this.registrations.splice(0)) registration.dispose();
  }
}
