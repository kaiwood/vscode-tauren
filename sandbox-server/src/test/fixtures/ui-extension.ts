import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { createReadTool } from '@earendil-works/pi-coding-agent';
import { Image } from '@earendil-works/pi-tui';
import { appendFile, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

/** Ordinary installed extension. Slash commands finish in preflight (no model I/O).
 * The companion offline provider is used only by the renderer/tool roundtrip test.
 */
export default function uiExtension(pi: ExtensionAPI): void {
  const component = (text: string) => ({ render: () => [text], invalidate() {} });
  let unsubscribe: (() => void) | undefined;
  let forkDialog = false;
  let reloadArtifacts = false;
  pi.registerCommand('ui-arm-fork-dialog', { handler: async () => { forkDialog = true; } });
  pi.on('session_before_fork', async (_event, ctx) => {
    if (!forkDialog) return;
    forkDialog = false;
    const result = await ctx.ui.input('before-fork-dialog');
    ctx.ui.notify(`before-fork-result:${String(result)}`);
    return { cancel: result === undefined };
  });
  pi.registerCommand('ui-reload-dialog', { handler: async (_args, ctx) => {
    reloadArtifacts = true;
    await ctx.reload();
  } });
  pi.on('session_shutdown', async (event, ctx) => {
    if (event.reason !== 'reload' || !reloadArtifacts) return;
    const result = await ctx.ui.input('shutdown-reload-dialog');
    ctx.ui.notify(`shutdown-reload-result:${String(result)}`);
    // Capture UI while the context is live: disposal runs after SDK context
    // invalidation, so dereferencing ctx.ui from dispose would itself throw.
    const ui = ctx.ui;
    ui.setWidget('shutdown-widget', () => ({
      ...component('old-shutdown-component'),
      dispose() { ui.notify('shutdown-widget:disposed'); }
    }));
    ctx.ui.addAutocompleteProvider(previous => ({
      ...previous, triggerCharacters: [...(previous.triggerCharacters ?? []), '^'],
      async getSuggestions(lines, line, col, options) {
        return lines[line]?.slice(0, col) === '^old'
          ? { prefix: '^old', items: [{ value: '^stale', label: 'Stale shutdown provider' }] }
          : previous.getSuggestions(lines, line, col, options);
      }
    }));
    ctx.ui.notify('shutdown-artifacts:created');
  });
  pi.registerMessageRenderer('ui-fixture', (message, options) => component(
    `message:${String(message.content)}:${options.expanded ? 'expanded' : 'collapsed'}`));
  // Override only the renderer: execution still delegates to the real SDK read tool.
  const read = createReadTool(process.cwd());
  pi.registerTool({ ...read, renderCall: args => component(`read-call:${args.path}`),
    renderResult: (_result, options) => component(`read-result:${options.expanded ? 'expanded' : 'collapsed'}`) });

  pi.on('session_start', async (_event, ctx) => {
    ctx.ui.notify('ui-fixture:session-start', 'info');
    ctx.ui.addAutocompleteProvider(previous => ({
      ...previous,
      triggerCharacters: [...(previous.triggerCharacters ?? []), '%'],
      async getSuggestions(lines, line, col, options) {
        return lines[line]?.slice(0, col) === '%ui'
          ? { prefix: '%ui', items: [{ value: '%ui-complete', label: 'UI completion', description: 'SDK factory' }] }
          : previous.getSuggestions(lines, line, col, options);
      },
      applyCompletion(lines, line, col, item, prefix) {
        if (item.value !== '%ui-complete') return previous.applyCompletion(lines, line, col, item, prefix);
        const updated = [...lines];
        updated[line] = (lines[line] ?? '').slice(0, col - prefix.length) + item.value + (lines[line] ?? '').slice(col);
        return { lines: updated, cursorLine: line, cursorCol: col - prefix.length + item.value.length };
      }
    }));
    if (process.env.UI_FIXTURE_STARTUP === 'dialog') await ctx.ui.input('startup-dialog');
  });
  pi.registerCommand('ui-dialogs', { handler: async (_args, ctx) => {
    const select = await ctx.ui.select('fixture-select', ['one', 'two']);
    const confirm = await ctx.ui.confirm('fixture-confirm', 'Continue?');
    const input = await ctx.ui.input('fixture-input', 'placeholder');
    const editor = await ctx.ui.editor('fixture-editor', 'prefill');
    ctx.ui.notify(`dialogs:${JSON.stringify({ select, confirm, input, editor })}`);
  } });
  pi.registerCommand('ui-notifications', { handler: async (_args, ctx) => {
    ctx.ui.notify('fixture-warning', 'warning');
    ctx.ui.setStatus('fixture', 'ready');
    ctx.ui.setWidget('lines', ['above']);
    ctx.ui.setWidget('component', () => component('below-component'), { placement: 'belowEditor' });
    ctx.ui.setFooter((_tui, _theme, data) => ({
      render: () => [`footer:${data.getExtensionStatuses().get('fixture')}`], invalidate() {}
    }));
    ctx.ui.setEditorText('fixture editor');
    ctx.ui.pasteToEditor(' pasted');
    ctx.ui.setToolsExpanded(true);
    ctx.ui.notify(`editor:${ctx.ui.getEditorText()};expanded:${ctx.ui.getToolsExpanded()}`);
  } });
  pi.registerCommand('ui-clear', { handler: async (_args, ctx) => {
    ctx.ui.setStatus('fixture', undefined);
    ctx.ui.setWidget('lines', undefined);
    ctx.ui.setWidget('component', undefined);
    ctx.ui.setFooter(undefined);
    unsubscribe?.(); unsubscribe = undefined;
  } });
  pi.registerCommand('ui-custom', { handler: async (_args, ctx) => {
    const value = await ctx.ui.custom<{ local: string; functionStayedLocal: boolean }>((tui, _theme, _keys, done) => {
      let text = 'initial';
      // Functions are intentionally not serializable. Only the final confirmation is sent to the host.
      const localValue = { local: 'secret-result', functionStayedLocal: typeof done === 'function' };
      return {
        render: width => [`custom:${text}:${width}`], invalidate() {},
        handleInput(input) {
          if (input === 'done') done(localValue);
          else { text = input; tui.requestRender(); }
        }
      };
    }, { overlay: true });
    ctx.ui.notify(`custom-result:${JSON.stringify(value ?? null)}`);
  } });
  // A nonblocking UI can outlive its slash command. This lets an idle runtime
  // reload/reset it; runtime.reload intentionally rejects active prompt preflight.
  pi.registerCommand('ui-background', { handler: async (_args, ctx) => {
    void ctx.ui.custom(() => component('background-surface'));
  } });
  pi.registerCommand('ui-timeout', { handler: async (_args, ctx) => {
    const result = await ctx.ui.select('fixture-timeout', ['one'], { timeout: 120 });
    ctx.ui.notify(`timeout:${String(result)}`);
  } });
  pi.registerCommand('ui-abort', { handler: async (_args, ctx) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 120);
    try {
      const result = await ctx.ui.input('fixture-abort', '', { signal: controller.signal });
      ctx.ui.notify(`abort:${String(result)}`);
    } finally { clearTimeout(timer); }
  } });
  pi.registerCommand('ui-terminal', { handler: async (_args, ctx) => {
    unsubscribe?.();
    unsubscribe = ctx.ui.onTerminalInput(input => input === 'consume' ? { consume: true }
      : input === 'transform' ? { data: 'transformed' } : undefined);
  } });
  pi.registerCommand('ui-wait', { handler: async (_args, ctx) => {
    const value = await ctx.ui.input('fixture-wait');
    ctx.ui.notify(`wait-result:${String(value)}`);
  } });
  pi.registerCommand('ui-sync-done', { handler: async (_args, ctx) => {
    const local = () => 'callable-result';
    let disposals = 0;
    const result = await ctx.ui.custom<typeof local>((_tui, _theme, _keys, done) => {
      done(local);
      return { ...component('must-not-mount'), dispose() { disposals++; } };
    });
    // Await mount cleanup's microtask, not a timing window.
    await Promise.resolve();
    ctx.ui.notify(`sync-done:${result === local}:${result()}:disposed=${disposals}`);
  } });
  pi.registerCommand('ui-async-factory', { handler: async (_args, ctx) => {
    const cwd = ctx.cwd; // Old SDK contexts are invalid after replacement/reload.
    void ctx.ui.custom(async () => {
      await writeFile(path.join(cwd, 'factory-entered'), 'entered');
      const deadline = Date.now() + 5_000;
      while (await readFile(path.join(cwd, 'factory-release'), 'utf8').catch(() => '') !== 'release') {
        if (Date.now() > deadline) throw new Error('factory gate timeout');
        await delay(10);
      }
      return { ...component('must-not-resurrect'), dispose() {
        void appendFile(path.join(cwd, 'factory-disposed'), 'disposed\n');
      } };
    });
  } });
  pi.registerCommand('ui-focus', { handler: async (_args, ctx) => {
    await ctx.ui.custom(() => {
      let inputs = 0;
      const focusComponent = { focused: false, invalidate() {},
        render() { return [`focus:${focusComponent.focused};inputs:${inputs}`]; },
        handleInput() { inputs++; }
      };
      return focusComponent;
    });
  } });
  pi.registerCommand('ui-image', { handler: async (_args, ctx) => {
    ctx.ui.setWidget('image', () => new Image(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=',
      'image/png', { fallbackColor: text => text }, { maxWidthCells: 4, maxHeightCells: 2, filename: 'pixel.png' },
      { widthPx: 1, heightPx: 1 }));
  } });
  pi.registerCommand('ui-terminal-ordered', { handler: async (_args, ctx) => {
    const remove = [
      ctx.ui.onTerminalInput(data => ({ data: `${data}:first` })),
      ctx.ui.onTerminalInput(data => {
        if (data === 'stop:first') return { consume: true };
        return { data: `${data}:second` };
      }),
      ctx.ui.onTerminalInput(data => { ctx.ui.notify(`terminal-last:${data}`); return { data: `${data}:third` }; })
    ];
    unsubscribe?.(); unsubscribe = () => { for (const off of remove) off(); };
  } });
  pi.registerCommand('ui-new-session', { handler: async (_args, ctx) => {
    await ctx.newSession({ withSession: async fresh => { fresh.ui.notify('new-session:fresh-context'); } });
  } });
  pi.registerCommand('ui-switch-session', { handler: async (args, ctx) => {
    await ctx.switchSession(args, { withSession: async fresh => { fresh.ui.notify('switch-session:fresh-context'); } });
  } });
  pi.registerCommand('ui-message', { handler: async () => {
    pi.sendMessage({ customType: 'ui-fixture', content: 'fixture payload', display: true });
  } });
}
