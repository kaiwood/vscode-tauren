import * as assert from 'assert';
import { TauSessionManager, type TauSessionManagerOptions } from '../../sessions/tauSessionManager';
import type { CustomUiHostMessage } from '../../extensionUi/customUiHost';
import type { ExtensionEditorHostMessage } from '../../extensionUi/types';
import type { WebviewSessionItem, WebviewStateMessage, WebviewTreeItem } from '../../webviewProtocol/types';
import type { SettingValue, TauSettingId } from '../../settings/settingsRegistry';
import type { PiClient } from '../../pi/clientTypes';
import type {
  PiAgentMessage,
  PiCommand,
  PiModel,
  PiClientOptions,
  PiSessionState,
  PiSessionStats,
  PiEvent
} from '../../pi/types';

suite('TauSessionManager', () => {
  test('tracks background session live status, unread state, and active persistence', async () => {
    const firstClient = new FakePiClient({
      state: {
        sessionFile: '/sessions/one.jsonl',
        model: { provider: 'openai', id: 'gpt-test', reasoning: false },
        thinkingLevel: 'off'
      }
    });
    const secondClient = new FakePiClient();
    const sessionFiles: Array<string | undefined> = [];
    const harness = createManagerHarness([firstClient, secondClient], {
      initialSessionFile: '/sessions/one.jsonl',
      onSessionFileChange: (sessionFile) => sessionFiles.push(sessionFile),
      listSessions: async (_cwd, currentSessionFile) => createSessionItems(currentSessionFile)
    });

    await harness.manager.handleWebviewMessage({ type: 'submit', text: 'run in the background' });
    await harness.manager.handleWebviewMessage({ type: 'newSession' });
    await flushPromises();
    await harness.manager.handleWebviewMessage({ type: 'showLane', lane: 'sessions' });

    let backgroundSession = findSession(lastState(harness), '/sessions/one.jsonl');
    assert.strictEqual(backgroundSession?.liveStatus, 'running');
    assert.strictEqual(backgroundSession?.unread, false);
    assert.strictEqual(sessionFiles.at(-1), undefined);

    const persistenceCountBeforeBackgroundEnd = sessionFiles.length;
    firstClient.emit({ type: 'agent_end' });
    await flushPromises();

    backgroundSession = findSession(lastState(harness), '/sessions/one.jsonl');
    assert.strictEqual(backgroundSession?.liveStatus, 'done');
    assert.strictEqual(backgroundSession?.unread, true);
    assert.strictEqual(sessionFiles.length, persistenceCountBeforeBackgroundEnd);

    await harness.manager.handleWebviewMessage({ type: 'selectSession', sessionPath: '/sessions/one.jsonl' });
    await flushPromises();

    assert.strictEqual(sessionFiles.at(-1), '/sessions/one.jsonl');
    assert.strictEqual(lastState(harness).currentSessionFile, '/sessions/one.jsonl');
    harness.manager.dispose();
  });

  test('surfaces extension status entries for the active session', async () => {
    const harness = createManagerHarness([new FakePiClient()]);

    await harness.manager.handleWebviewMessage({ type: 'submit', text: 'hello' });

    const extensionUi = harness.clientOptions[0].extensionUi;
    assert.ok(extensionUi);

    extensionUi.setStatus?.('plan-mode', 'Planning');
    assert.deepStrictEqual(lastState(harness).extensionStatus, [
      { key: 'plan-mode', text: 'Planning' }
    ]);

    extensionUi.setStatus?.('review', 'Reviewing');
    assert.deepStrictEqual(lastState(harness).extensionStatus, [
      { key: 'plan-mode', text: 'Planning' },
      { key: 'review', text: 'Reviewing' }
    ]);

    extensionUi.setStatus?.('plan-mode', undefined);
    assert.deepStrictEqual(lastState(harness).extensionStatus, [
      { key: 'review', text: 'Reviewing' }
    ]);

    extensionUi.clearStatuses?.();
    assert.deepStrictEqual(lastState(harness).extensionStatus, []);
    harness.manager.dispose();
  });

  test('surfaces extension widgets for the active session', async () => {
    const harness = createManagerHarness([new FakePiClient()]);

    await harness.manager.handleWebviewMessage({ type: 'submit', text: 'hello' });

    const extensionUi = harness.clientOptions[0].extensionUi;
    assert.ok(extensionUi);

    extensionUi.setWidget?.('plan', ['\u001b[32mPlanning\u001b[0m']);
    assert.deepStrictEqual(lastState(harness).extensionWidgets, [
      { key: 'plan', placement: 'aboveEditor', lines: ['\u001b[32mPlanning\u001b[0m'] }
    ]);

    extensionUi.setWidget?.('review', ['Reviewing'], { placement: 'belowEditor' });
    assert.deepStrictEqual(lastState(harness).extensionWidgets, [
      { key: 'plan', placement: 'aboveEditor', lines: ['\u001b[32mPlanning\u001b[0m'] },
      { key: 'review', placement: 'belowEditor', lines: ['Reviewing'] }
    ]);

    extensionUi.setWidget?.('plan', undefined);
    assert.deepStrictEqual(lastState(harness).extensionWidgets, [
      { key: 'review', placement: 'belowEditor', lines: ['Reviewing'] }
    ]);

    extensionUi.clearWidgets?.();
    assert.deepStrictEqual(lastState(harness).extensionWidgets, []);
    harness.manager.dispose();
  });

  test('clears and ignores above extension widgets when disabled in settings', async () => {
    const harness = createManagerHarness([new FakePiClient()]);

    await harness.manager.handleWebviewMessage({ type: 'submit', text: 'hello' });

    const extensionUi = harness.clientOptions[0].extensionUi;
    assert.ok(extensionUi);

    let disposed = false;
    extensionUi.setWidget?.('above', () => ({
      render: () => ['above rendered'],
      invalidate: () => undefined,
      dispose: () => { disposed = true; }
    }));
    extensionUi.setWidget?.('below', ['Below'], { placement: 'belowEditor' });
    await flushPromises();
    assert.deepStrictEqual(lastState(harness).extensionWidgets, [
      { key: 'above', placement: 'aboveEditor', lines: ['above rendered'] },
      { key: 'below', placement: 'belowEditor', lines: ['Below'] }
    ]);

    await harness.manager.handleWebviewMessage({
      type: 'updateSetting',
      settingId: 'tau.extensions.aboveWidgetsEnabled',
      value: false
    });

    assert.strictEqual(disposed, true);
    assert.strictEqual(lastState(harness).settings?.values['tau.extensions.aboveWidgetsEnabled'], false);
    assert.deepStrictEqual(lastState(harness).extensionWidgets, [
      { key: 'below', placement: 'belowEditor', lines: ['Below'] }
    ]);

    let renderedWhileDisabled = false;
    extensionUi.setWidget?.('ignored-above', () => ({
      render: () => {
        renderedWhileDisabled = true;
        return ['ignored'];
      },
      invalidate: () => undefined
    }));
    extensionUi.setWidget?.('ignored-lines', ['ignored']);
    extensionUi.setWidget?.('below-2', ['Still enabled'], { placement: 'belowEditor' });
    await flushPromises();

    assert.strictEqual(renderedWhileDisabled, false);
    assert.deepStrictEqual(lastState(harness).extensionWidgets, [
      { key: 'below', placement: 'belowEditor', lines: ['Below'] },
      { key: 'below-2', placement: 'belowEditor', lines: ['Still enabled'] }
    ]);
    assert.strictEqual(harness.tauSettings['tau.extensions.aboveWidgetsEnabled'], false);
    harness.manager.dispose();
  });

  test('initializes extension widget and status settings from persisted Tau settings', async () => {
    const harness = createManagerHarness([new FakePiClient()], {
      tauSettings: {
        'tau.extensions.aboveWidgetsEnabled': false,
        'tau.extensions.statusBarEnabled': false
      }
    });

    await harness.manager.handleWebviewMessage({ type: 'submit', text: 'hello' });

    const extensionUi = harness.clientOptions[0].extensionUi;
    assert.ok(extensionUi);

    extensionUi.setWidget?.('ignored-above', ['Ignored']);
    extensionUi.setWidget?.('below', ['Below'], { placement: 'belowEditor' });
    extensionUi.setStatus?.('ignored', 'Ignored');

    assert.strictEqual(lastState(harness).settings?.values['tau.extensions.aboveWidgetsEnabled'], false);
    assert.strictEqual(lastState(harness).settings?.values['tau.extensions.statusBarEnabled'], false);
    assert.deepStrictEqual(lastState(harness).extensionWidgets, [
      { key: 'below', placement: 'belowEditor', lines: ['Below'] }
    ]);
    assert.deepStrictEqual(lastState(harness).extensionStatus, []);
    harness.manager.dispose();
  });

  test('refreshes extension settings changed outside the Tau settings face', async () => {
    const harness = createManagerHarness([new FakePiClient()]);

    await harness.manager.handleWebviewMessage({ type: 'submit', text: 'hello' });

    const extensionUi = harness.clientOptions[0].extensionUi;
    assert.ok(extensionUi);

    extensionUi.setWidget?.('above', ['Above']);
    extensionUi.setStatus?.('plan', 'Planning');
    assert.deepStrictEqual(lastState(harness).extensionWidgets, [
      { key: 'above', placement: 'aboveEditor', lines: ['Above'] }
    ]);
    assert.deepStrictEqual(lastState(harness).extensionStatus, [
      { key: 'plan', text: 'Planning' }
    ]);

    harness.tauSettings['tau.extensions.aboveWidgetsEnabled'] = false;
    harness.tauSettings['tau.extensions.statusBarEnabled'] = false;
    harness.manager.refreshTauSettingValues();

    assert.strictEqual(lastState(harness).settings?.values['tau.extensions.aboveWidgetsEnabled'], false);
    assert.strictEqual(lastState(harness).settings?.values['tau.extensions.statusBarEnabled'], false);
    assert.deepStrictEqual(lastState(harness).extensionWidgets, []);
    assert.deepStrictEqual(lastState(harness).extensionStatus, []);
    harness.manager.dispose();
  });

  test('clears and ignores below extension widgets when disabled in settings', async () => {
    const harness = createManagerHarness([new FakePiClient()]);

    await harness.manager.handleWebviewMessage({ type: 'submit', text: 'hello' });

    const extensionUi = harness.clientOptions[0].extensionUi;
    assert.ok(extensionUi);

    extensionUi.setWidget?.('above', ['Above']);
    extensionUi.setWidget?.('below', ['Below'], { placement: 'belowEditor' });
    assert.deepStrictEqual(lastState(harness).extensionWidgets, [
      { key: 'above', placement: 'aboveEditor', lines: ['Above'] },
      { key: 'below', placement: 'belowEditor', lines: ['Below'] }
    ]);

    await harness.manager.handleWebviewMessage({
      type: 'updateSetting',
      settingId: 'tau.extensions.belowWidgetsEnabled',
      value: false
    });

    assert.strictEqual(lastState(harness).settings?.values['tau.extensions.belowWidgetsEnabled'], false);
    assert.deepStrictEqual(lastState(harness).extensionWidgets, [
      { key: 'above', placement: 'aboveEditor', lines: ['Above'] }
    ]);

    extensionUi.setWidget?.('ignored-below', ['Ignored'], { placement: 'belowEditor' });
    extensionUi.setWidget?.('above-2', ['Still enabled']);
    assert.deepStrictEqual(lastState(harness).extensionWidgets, [
      { key: 'above', placement: 'aboveEditor', lines: ['Above'] },
      { key: 'above-2', placement: 'aboveEditor', lines: ['Still enabled'] }
    ]);
    harness.manager.dispose();
  });

  test('clears and ignores extension status when disabled in settings', async () => {
    const harness = createManagerHarness([new FakePiClient()]);

    await harness.manager.handleWebviewMessage({ type: 'submit', text: 'hello' });

    const extensionUi = harness.clientOptions[0].extensionUi;
    assert.ok(extensionUi);

    extensionUi.setStatus?.('plan', 'Planning');
    assert.deepStrictEqual(lastState(harness).extensionStatus, [
      { key: 'plan', text: 'Planning' }
    ]);

    await harness.manager.handleWebviewMessage({
      type: 'updateSetting',
      settingId: 'tau.extensions.statusBarEnabled',
      value: false
    });

    assert.strictEqual(lastState(harness).settings?.values['tau.extensions.statusBarEnabled'], false);
    assert.strictEqual(harness.tauSettings['tau.extensions.statusBarEnabled'], false);
    assert.deepStrictEqual(lastState(harness).extensionStatus, []);

    extensionUi.setStatus?.('ignored', 'Ignored');
    assert.deepStrictEqual(lastState(harness).extensionStatus, []);
    harness.manager.dispose();
  });

  test('sets composer text from the active session extension UI', async () => {
    const harness = createManagerHarness([new FakePiClient()]);

    await harness.manager.handleWebviewMessage({ type: 'submit', text: 'hello' });

    const extensionUi = harness.clientOptions[0].extensionUi;
    assert.ok(extensionUi);

    extensionUi.setEditorText?.('prefilled by extension');

    assert.strictEqual(lastState(harness).composerText, 'prefilled by extension');
    assert.strictEqual(lastState(harness).composerTextRevision, 1);
    harness.manager.dispose();
  });

  test('pastes text from the active session extension UI', async () => {
    const harness = createManagerHarness([new FakePiClient()]);

    await harness.manager.handleWebviewMessage({ type: 'submit', text: 'hello' });

    const extensionUi = harness.clientOptions[0].extensionUi;
    assert.ok(extensionUi);

    extensionUi.pasteToEditor?.('pasted by extension');

    assert.deepStrictEqual(lastState(harness).composerPaste, {
      text: 'pasted by extension',
      revision: 1
    });
    harness.manager.dispose();
  });

  test('resolves extension editor save and cancel requests', async () => {
    const harness = createManagerHarness([new FakePiClient()]);

    await harness.manager.handleWebviewMessage({ type: 'submit', text: 'hello' });

    const extensionUi = harness.clientOptions[0].extensionUi;
    assert.ok(extensionUi);

    const savePromise = extensionUi.editor?.('Edit plan', 'initial text');
    assert.ok(savePromise);
    assert.deepStrictEqual(harness.extensionEditorMessages.at(-1), {
      type: 'extensionEditorShow',
      id: 'extension-editor-1',
      title: 'Edit plan',
      prefill: 'initial text'
    });

    await harness.manager.handleWebviewMessage({ type: 'extensionEditorSave', id: 'extension-editor-1', text: 'edited text' });
    assert.strictEqual(await savePromise, 'edited text');

    const cancelPromise = extensionUi.editor?.('Edit again', undefined);
    assert.ok(cancelPromise);
    assert.deepStrictEqual(harness.extensionEditorMessages.at(-1), {
      type: 'extensionEditorShow',
      id: 'extension-editor-2',
      title: 'Edit again',
      prefill: ''
    });

    await harness.manager.handleWebviewMessage({ type: 'extensionEditorCancel', id: 'extension-editor-2' });
    assert.strictEqual(await cancelPromise, undefined);
    harness.manager.dispose();
  });

  test('rejects concurrent extension editor requests', async () => {
    const harness = createManagerHarness([new FakePiClient()]);

    await harness.manager.handleWebviewMessage({ type: 'submit', text: 'hello' });

    const extensionUi = harness.clientOptions[0].extensionUi;
    assert.ok(extensionUi);

    const firstPromise = extensionUi.editor?.('First', 'one');
    const secondPromise = extensionUi.editor?.('Second', 'two');
    assert.ok(firstPromise);
    assert.ok(secondPromise);

    assert.strictEqual(await secondPromise, undefined);
    assert.strictEqual(harness.extensionEditorMessages.filter((message) => message.type === 'extensionEditorShow').length, 1);

    await harness.manager.handleWebviewMessage({ type: 'extensionEditorSave', id: 'extension-editor-1', text: 'done' });
    assert.strictEqual(await firstPromise, 'done');
    harness.manager.dispose();
  });

  test('activates source session when background extension UI sets composer text', async () => {
    const firstClient = new FakePiClient({ state: { sessionFile: '/sessions/one.jsonl' } });
    const secondClient = new FakePiClient({ state: { sessionFile: '/sessions/two.jsonl' } });
    const sessionFiles: Array<string | undefined> = [];
    const harness = createManagerHarness([firstClient, secondClient], {
      initialSessionFile: '/sessions/one.jsonl',
      onSessionFileChange: (sessionFile) => sessionFiles.push(sessionFile),
      listSessions: async (_cwd, currentSessionFile) => createSessionItems(currentSessionFile)
    });

    await harness.manager.handleWebviewMessage({ type: 'submit', text: 'run in the background' });
    await harness.manager.handleWebviewMessage({ type: 'newSession' });
    await flushPromises();

    const backgroundExtensionUi = harness.clientOptions[0].extensionUi;
    assert.ok(backgroundExtensionUi);

    backgroundExtensionUi.setEditorText?.('source session draft');

    const state = lastState(harness);
    assert.strictEqual(state.currentSessionFile, '/sessions/one.jsonl');
    assert.strictEqual(state.composerText, 'source session draft');
    assert.strictEqual(state.composerTextRevision, 1);
    assert.strictEqual(state.lane, undefined);
    assert.strictEqual(state.chatFace, undefined);
    assert.strictEqual(sessionFiles.at(-1), '/sessions/one.jsonl');
    harness.manager.dispose();
  });

  test('renders component widgets and updates dimensions', async () => {
    const harness = createManagerHarness([new FakePiClient()]);

    await harness.manager.handleWebviewMessage({ type: 'submit', text: 'hello' });

    const extensionUi = harness.clientOptions[0].extensionUi;
    assert.ok(extensionUi);

    let renderedWidth = 0;
    extensionUi.setWidget?.('component', (_tui) => ({
      render: (width) => {
        renderedWidth = width;
        return [`width ${width}`];
      },
      invalidate: () => undefined
    }));
    await flushPromises();

    assert.deepStrictEqual(lastState(harness).extensionWidgets, [
      { key: 'component', placement: 'aboveEditor', lines: ['width 80'] }
    ]);

    await harness.manager.handleWebviewMessage({ type: 'extensionWidgetDimensions', key: 'component', columns: 42, rows: 3 });
    await wait(20);

    assert.strictEqual(renderedWidth, 42);
    assert.deepStrictEqual(lastState(harness).extensionWidgets, [
      { key: 'component', placement: 'aboveEditor', lines: ['width 42'] }
    ]);
    harness.manager.dispose();
  });

  test('reinitializes above widgets after clearing extension UI state', async () => {
    const harness = createManagerHarness([new FakePiClient()]);

    await harness.manager.handleWebviewMessage({ type: 'submit', text: 'hello' });

    const extensionUi = harness.clientOptions[0].extensionUi;
    assert.ok(extensionUi);

    let disposed = false;
    extensionUi.setWidget?.('above', () => ({
      render: () => ['before reload'],
      invalidate: () => undefined,
      dispose: () => { disposed = true; }
    }));
    await flushPromises();

    extensionUi.clearWidgets?.();
    assert.strictEqual(disposed, true);
    assert.deepStrictEqual(lastState(harness).extensionWidgets, []);

    extensionUi.setWidget?.('above', () => ({
      render: () => ['after reload'],
      invalidate: () => undefined
    }));
    await flushPromises();

    assert.deepStrictEqual(lastState(harness).extensionWidgets, [
      { key: 'above', placement: 'aboveEditor', lines: ['after reload'] }
    ]);
    harness.manager.dispose();
  });

  test('disposes replaced widget before mounting the replacement', async () => {
    const harness = createManagerHarness([new FakePiClient()]);

    await harness.manager.handleWebviewMessage({ type: 'submit', text: 'hello' });

    const extensionUi = harness.clientOptions[0].extensionUi;
    assert.ok(extensionUi);

    let disposed = false;
    extensionUi.setWidget?.('component', () => ({
      render: () => ['first'],
      invalidate: () => undefined,
      dispose: () => { disposed = true; }
    }));
    await flushPromises();

    disposed = false;
    extensionUi.setWidget?.('component', () => {
      assert.strictEqual(disposed, true);
      disposed = false;
      return {
        render: () => disposed ? ['blank'] : ['replacement'],
        invalidate: () => undefined,
        dispose: () => { disposed = true; }
      };
    });
    await flushPromises();

    assert.deepStrictEqual(lastState(harness).extensionWidgets, [
      { key: 'component', placement: 'aboveEditor', lines: ['replacement'] }
    ]);
    harness.manager.dispose();
  });

  test('keeps background custom UI hidden until its session is selected', async () => {
    const firstClient = new FakePiClient({ state: { sessionFile: '/sessions/one.jsonl' } });
    const secondClient = new FakePiClient();
    const harness = createManagerHarness([firstClient, secondClient], {
      initialSessionFile: '/sessions/one.jsonl',
      listSessions: async (_cwd, currentSessionFile) => createSessionItems(currentSessionFile)
    });
    harness.manager.setCustomUiViewAttached(true);

    await harness.manager.handleWebviewMessage({ type: 'submit', text: 'run in the background' });
    await harness.manager.handleWebviewMessage({ type: 'newSession' });
    await flushPromises();

    const customPromise = harness.clientOptions[0].extensionUi?.custom?.<string>((_tui, _theme, _keybindings, done) => ({
      render: () => ['background custom ui'],
      handleInput: (data) => done(data),
      invalidate: () => undefined
    }));
    await flushPromises();
    await harness.manager.handleWebviewMessage({ type: 'showLane', lane: 'sessions' });

    assert.ok(customPromise);
    assert.strictEqual(harness.customUiMessages.some((message) => message.type === 'customUiShow'), false);
    const backgroundSession = findSession(lastState(harness), '/sessions/one.jsonl');
    assert.strictEqual(backgroundSession?.customUiOpen, true);
    assert.strictEqual(backgroundSession?.unread, true);

    await harness.manager.handleWebviewMessage({ type: 'selectSession', sessionPath: '/sessions/one.jsonl' });
    await flushPromises();

    const show = harness.customUiMessages.find((message): message is { type: 'customUiShow'; id: string } => message.type === 'customUiShow');
    assert.ok(show);
    assert.ok(harness.customUiMessages.some((message) => message.type === 'customUiRender' && message.id === show.id && message.lines[0] === 'background custom ui'));

    await harness.manager.handleWebviewMessage({ type: 'customUiInput', id: show.id, data: 'answered' });
    assert.strictEqual(await customPromise, 'answered');
    harness.manager.dispose();
  });

  test('keeps background custom UI visible when another session already has one', async () => {
    const firstClient = new FakePiClient({ state: { sessionFile: '/sessions/one.jsonl' } });
    const secondClient = new FakePiClient({ state: { sessionFile: '/sessions/two.jsonl' } });
    const harness = createManagerHarness([firstClient, secondClient], {
      initialSessionFile: '/sessions/one.jsonl',
      listSessions: async (_cwd, currentSessionFile) => createSessionItems(currentSessionFile)
    });
    harness.manager.setCustomUiViewAttached(true);

    await harness.manager.handleWebviewMessage({ type: 'submit', text: 'run in the background' });
    await harness.manager.handleWebviewMessage({ type: 'newSession' });
    await flushPromises();

    const activePromise = harness.clientOptions[1].extensionUi?.custom?.<string>(() => ({
      render: () => ['active custom ui'],
      invalidate: () => undefined
    }));
    await flushPromises();

    const backgroundPromise = harness.clientOptions[0].extensionUi?.custom?.<string>(() => ({
      render: () => ['background custom ui'],
      invalidate: () => undefined
    }));
    await flushPromises();

    assert.ok(activePromise);
    assert.ok(backgroundPromise);
    harness.customUiMessages.length = 0;

    await harness.manager.handleWebviewMessage({ type: 'selectSession', sessionPath: '/sessions/one.jsonl' });
    await flushPromises();

    const show = harness.customUiMessages.find((message): message is { type: 'customUiShow'; id: string } => message.type === 'customUiShow');
    assert.ok(show);
    assert.ok(harness.customUiMessages.some((message) => message.type === 'customUiRender' && message.id === show.id && message.lines[0] === 'background custom ui'));

    let webviewActiveId: string | undefined;
    for (const message of harness.customUiMessages) {
      if (message.type === 'customUiShow') {
        webviewActiveId = message.id;
      }

      if (message.type === 'customUiHide' && message.id === webviewActiveId) {
        webviewActiveId = undefined;
      }
    }

    assert.strictEqual(webviewActiveId, show.id);
    harness.manager.dispose();
    assert.strictEqual(await activePromise, undefined);
    assert.strictEqual(await backgroundPromise, undefined);
  });

  test('keeps session list data after selecting an unopened session', async () => {
    const harness = createManagerHarness([new FakePiClient({ state: { sessionFile: '/sessions/two.jsonl' } })], {
      listSessions: async (_cwd, currentSessionFile) => createSessionItems(currentSessionFile)
    });

    await harness.manager.handleWebviewMessage({ type: 'showLane', lane: 'sessions' });
    await harness.manager.handleWebviewMessage({ type: 'selectSession', sessionPath: '/sessions/two.jsonl' });
    await flushPromises();

    assert.strictEqual(lastState(harness).currentSessionFile, '/sessions/two.jsonl');
    assert.strictEqual(findSession(lastState(harness), '/sessions/two.jsonl')?.modified, '2026-01-01T00:01:00.000Z');
    harness.manager.dispose();
  });

  test('moves unsent prompt context to a new session', async () => {
    const client = new FakePiClient();
    const harness = createManagerHarness([client]);

    harness.manager.addPromptContext({
      kind: 'file',
      path: 'src/foo.ts',
      label: 'foo.ts',
      title: 'src/foo.ts'
    });

    await harness.manager.handleWebviewMessage({ type: 'newSession' });
    await flushPromises();

    assert.deepStrictEqual(lastState(harness).promptContext, [
      { id: 'context-1', kind: 'file', label: 'foo.ts', title: 'src/foo.ts', xml: '<ide_context source="vscode-tau">\nUser-attached IDE context.\n\n<file path="src/foo.ts" />\n</ide_context>' }
    ]);

    await harness.manager.handleWebviewMessage({ type: 'submit', text: 'explain this' });

    assert.strictEqual(client.prompts.length, 1);
    assert.ok(client.prompts[0].startsWith('explain this\n\n<ide_context source="vscode-tau">\n'));
    assert.ok(client.prompts[0].includes('<file path="src/foo.ts" />'));
    assert.strictEqual(lastState(harness).promptContext, undefined);
    harness.manager.dispose();
  });

  test('moves unsent prompt context when selecting another open session', async () => {
    const newSessionClient = new FakePiClient();
    const selectedSessionClient = new FakePiClient();
    const harness = createManagerHarness([newSessionClient, selectedSessionClient], {
      initialSessionFile: '/sessions/one.jsonl'
    });

    await harness.manager.handleWebviewMessage({ type: 'newSession' });
    await flushPromises();

    harness.manager.addPromptContext({
      kind: 'file',
      path: 'src/foo.ts',
      label: 'foo.ts',
      title: 'src/foo.ts'
    });
    await harness.manager.handleWebviewMessage({ type: 'selectSession', sessionPath: '/sessions/one.jsonl' });
    await flushPromises();

    assert.deepStrictEqual(lastState(harness).promptContext, [
      { id: 'context-1', kind: 'file', label: 'foo.ts', title: 'src/foo.ts', xml: '<ide_context source="vscode-tau">\nUser-attached IDE context.\n\n<file path="src/foo.ts" />\n</ide_context>' }
    ]);

    await harness.manager.handleWebviewMessage({ type: 'submit', text: 'explain this' });

    assert.strictEqual(selectedSessionClient.prompts.length, 1);
    assert.ok(selectedSessionClient.prompts[0].includes('<file path="src/foo.ts" />'));
    assert.deepStrictEqual(newSessionClient.prompts, []);
    harness.manager.dispose();
  });

  test('shows restored per-session diff stats when selecting a resumed session', async () => {
    const sessionPath = '/sessions/resumed.jsonl';
    const harness = createManagerHarness([new FakePiClient({ state: { sessionFile: sessionPath } })], {
      loadSessionDiffSnapshot: (requestedSessionPath) => requestedSessionPath === sessionPath
        ? { stats: { addedLines: 2, removedLines: 1 } }
        : undefined
    });

    await harness.manager.handleWebviewMessage({ type: 'selectSession', sessionPath });
    await flushPromises();
    await wait(20);

    assert.deepStrictEqual(lastState(harness).workspaceDiffStats, { addedLines: 2, removedLines: 1 });
    harness.manager.dispose();
  });

  test('auto-disposes an inactive session after 30 minutes', async () => {
    const harness = createManagerHarness([new FakePiClient()], {
      initialSessionFile: '/sessions/one.jsonl',
      listSessions: async (_cwd, currentSessionFile) => createSessionItems(currentSessionFile)
    });
    const originalSetTimeout = globalThis.setTimeout;
    const originalClearTimeout = globalThis.clearTimeout;
    const originalDateNow = Date.now;
    const inactiveDisposeDelayMs = 30 * 60 * 1000;
    const scheduledTimeouts: Array<{ callback: () => void; delay: number | undefined }> = [];
    let now = 1_000;

    try {
      Date.now = () => now;
      globalThis.setTimeout = ((handler: (...args: unknown[]) => void, delay?: number, ...args: unknown[]) => {
        scheduledTimeouts.push({
          callback: () => handler(...args),
          delay
        });
        return { unref() {} } as ReturnType<typeof setTimeout>;
      }) as typeof setTimeout;
      globalThis.clearTimeout = (() => undefined) as typeof clearTimeout;

      await harness.manager.handleWebviewMessage({ type: 'newSession' });
      await harness.manager.handleWebviewMessage({ type: 'showLane', lane: 'sessions' });
      await flushPromises();

      assert.strictEqual(findSession(lastState(harness), '/sessions/one.jsonl')?.liveStatus, 'idle');

      const inactiveDisposeTimer = scheduledTimeouts.find((entry) => entry.delay === inactiveDisposeDelayMs);
      assert.ok(inactiveDisposeTimer, 'Expected inactive session disposal to be scheduled');

      now += inactiveDisposeDelayMs;
      inactiveDisposeTimer.callback();
      await flushPromises();

      assert.strictEqual(findSession(lastState(harness), '/sessions/one.jsonl')?.liveStatus, undefined);
    } finally {
      harness.manager.dispose();
      Date.now = originalDateNow;
      globalThis.setTimeout = originalSetTimeout;
      globalThis.clearTimeout = originalClearTimeout;
    }
  });

  test('keeps only the three most recent inactive sessions', async () => {
    const harness = createManagerHarness([new FakePiClient(), new FakePiClient(), new FakePiClient(), new FakePiClient()], {
      initialSessionFile: '/sessions/one.jsonl',
      listSessions: async (_cwd, currentSessionFile) => createSessionItems(currentSessionFile)
    });

    await harness.manager.handleWebviewMessage({ type: 'newSession' });
    await harness.manager.handleWebviewMessage({ type: 'newSession' });
    await harness.manager.handleWebviewMessage({ type: 'newSession' });
    await harness.manager.handleWebviewMessage({ type: 'showLane', lane: 'sessions' });
    await flushPromises();

    assert.strictEqual(findSession(lastState(harness), '/sessions/one.jsonl')?.liveStatus, 'idle');

    await harness.manager.handleWebviewMessage({ type: 'newSession' });
    await harness.manager.handleWebviewMessage({ type: 'showLane', lane: 'sessions' });
    await flushPromises();

    assert.strictEqual(findSession(lastState(harness), '/sessions/one.jsonl')?.liveStatus, undefined);
    harness.manager.dispose();
  });

  test('renames a running open background session without opening another client', async () => {
    const backgroundClient = new FakePiClient({
      state: {
        sessionFile: '/sessions/one.jsonl',
        model: { provider: 'openai', id: 'gpt-test', reasoning: false },
        thinkingLevel: 'off'
      }
    });
    const activeClient = new FakePiClient();
    const harness = createManagerHarness([backgroundClient, activeClient], {
      initialSessionFile: '/sessions/one.jsonl',
      listSessions: async (_cwd, currentSessionFile) => createSessionItems(currentSessionFile)
    });

    await harness.manager.handleWebviewMessage({ type: 'submit', text: 'keep running' });
    await harness.manager.handleWebviewMessage({ type: 'newSession' });
    await flushPromises();
    await harness.manager.handleWebviewMessage({ type: 'showLane', lane: 'sessions' });
    await harness.manager.handleWebviewMessage({ type: 'setSessionItemName', sessionPath: '/sessions/one.jsonl', name: 'Renamed while running' });
    await flushPromises();

    assert.deepStrictEqual(backgroundClient.sessionNames, ['Renamed while running']);
    assert.strictEqual(harness.createCalls, 2);
    assert.strictEqual(findSession(lastState(harness), '/sessions/one.jsonl')?.name, 'Renamed while running');
    assert.strictEqual(findSession(lastState(harness), '/sessions/one.jsonl')?.liveStatus, 'running');
    harness.manager.dispose();
  });

  test('sends text to the active visible composer', async () => {
    const harness = createManagerHarness([new FakePiClient()]);
    await flushPromises();

    harness.manager.sendTextToComposer('selected line');

    const state = findComposerState(harness, 'selected line');
    assert.ok(state);
    assert.strictEqual(state.composerTextRevision, 1);
    assert.strictEqual(harness.createCalls, 0);
    harness.manager.dispose();
  });

  test('appends text to the active visible composer', async () => {
    const harness = createManagerHarness([new FakePiClient()]);
    await flushPromises();

    harness.manager.appendTextToComposer('selected line');

    const state = findComposerState(harness, 'selected line');
    assert.ok(state);
    assert.strictEqual(state.composerTextRevision, 1);
    assert.strictEqual(state.composerTextMode, 'append');
    assert.strictEqual(harness.createCalls, 0);
    harness.manager.dispose();
  });

  test('opens a new chat session when sending text from a hidden composer lane', async () => {
    const harness = createManagerHarness([new FakePiClient()]);

    await harness.manager.handleWebviewMessage({ type: 'showLane', lane: 'sessions' });
    assert.strictEqual(lastState(harness).lane, 'sessions');

    harness.manager.sendTextToComposer('selected line');
    await flushPromises();

    assert.ok(findComposerState(harness, 'selected line'));
    assert.strictEqual(harness.createCalls, 1);
    harness.manager.dispose();
  });

  test('opens a new chat session when appending text from a hidden composer lane', async () => {
    const harness = createManagerHarness([new FakePiClient()]);

    await harness.manager.handleWebviewMessage({ type: 'showLane', lane: 'sessions' });
    assert.strictEqual(lastState(harness).lane, 'sessions');

    harness.manager.appendTextToComposer('selected line');
    await flushPromises();

    const state = findComposerState(harness, 'selected line');
    assert.ok(state);
    assert.strictEqual(state.composerTextMode, 'append');
    assert.strictEqual(harness.createCalls, 1);
    harness.manager.dispose();
  });

  test('blocks forks while a background session is running', async () => {
    const firstClient = new FakePiClient();
    const secondClient = new FakePiClient();
    const harness = createManagerHarness([firstClient, secondClient], {
      initialSessionFile: '/sessions/one.jsonl'
    });

    await harness.manager.handleWebviewMessage({ type: 'submit', text: 'keep running' });
    await harness.manager.handleWebviewMessage({ type: 'newSession' });
    await flushPromises();
    await harness.manager.handleWebviewMessage({ type: 'submit', text: '/fork' });

    assert.deepStrictEqual(harness.notifications, [
      { message: 'Wait for background sessions to finish before forking.', type: 'warning' }
    ]);
    assert.deepStrictEqual(secondClient.forkedEntries, []);
    harness.manager.dispose();
  });
});

type ManagerHarness = {
  manager: TauSessionManager;
  states: WebviewStateMessage[];
  notifications: { message: string; type: string }[];
  clientOptions: PiClientOptions[];
  customUiMessages: CustomUiHostMessage[];
  extensionEditorMessages: ExtensionEditorHostMessage[];
  tauSettings: Partial<Record<TauSettingId, SettingValue>>;
  readonly createCalls: number;
};

type ManagerHarnessOptions = {
  cwd?: string;
  initialSessionFile?: string;
  tauSettings?: Partial<Record<TauSettingId, SettingValue>>;
  onSessionFileChange?: (sessionFile: string | undefined) => void;
  listSessions?: TauSessionManagerOptions['listSessions'];
  loadSessionDiffSnapshot?: TauSessionManagerOptions['loadSessionDiffSnapshot'];
};

function createManagerHarness(
  clients: FakePiClient[],
  options: ManagerHarnessOptions = {}
): ManagerHarness {
  const states: WebviewStateMessage[] = [];
  const notifications: { message: string; type: string }[] = [];
  const clientOptions: PiClientOptions[] = [];
  const customUiMessages: CustomUiHostMessage[] = [];
  const extensionEditorMessages: ExtensionEditorHostMessage[] = [];
  const tauSettings: Partial<Record<TauSettingId, SettingValue>> = { ...(options.tauSettings ?? {}) };
  const pendingClients = [...clients];
  let createCalls = 0;

  const manager = new TauSessionManager({
    createClient: (clientOption) => {
      createCalls += 1;
      clientOptions.push(clientOption);
      const client = pendingClients.shift();
      assert.ok(client, 'Expected a fake client to be available');
      return client;
    },
    postState: (message) => states.push(message),
    showNotification: (message, type) => notifications.push({ message, type }),
    getCwd: () => options.cwd === undefined && Object.prototype.hasOwnProperty.call(options, 'cwd') ? undefined : options.cwd ?? '/workspace',
    getTauSettingValues: () => ({ ...tauSettings }),
    updateTauSetting: async (settingId, value) => {
      tauSettings[settingId] = value;
    },
    initialSessionFile: options.initialSessionFile,
    onSessionFileChange: options.onSessionFileChange,
    listSessions: options.listSessions,
    loadSessionDiffSnapshot: options.loadSessionDiffSnapshot,
    customUi: {
      isAvailable: () => true,
      postMessage: (message) => {
        customUiMessages.push(message);
        return true;
      },
      getOutputColors: () => true
    },
    extensionEditor: {
      isAvailable: () => true,
      postMessage: (message) => {
        extensionEditorMessages.push(message);
        return true;
      }
    },
    extensionUi: {
      notify: (message, type) => notifications.push({ message, type }),
      select: async () => undefined,
      confirm: async () => undefined,
      input: async () => undefined
    }
  });

  return {
    manager,
    states,
    notifications,
    clientOptions,
    customUiMessages,
    extensionEditorMessages,
    tauSettings,
    get createCalls(): number {
      return createCalls;
    }
  };
}

function createSessionItems(currentSessionFile: string | undefined): WebviewSessionItem[] {
  return [
    createSessionItem('/sessions/one.jsonl', 'one', currentSessionFile),
    createSessionItem('/sessions/two.jsonl', 'two', currentSessionFile)
  ];
}

function createSessionItem(path: string, id: string, currentSessionFile: string | undefined): WebviewSessionItem {
  return {
    path,
    id,
    cwd: '/workspace',
    created: '2026-01-01T00:00:00.000Z',
    modified: '2026-01-01T00:01:00.000Z',
    messageCount: 1,
    firstMessage: `${id} question`,
    depth: 0,
    isLast: id === 'two',
    ancestorContinues: [],
    current: path === currentSessionFile
  };
}

function findSession(state: WebviewStateMessage, path: string): WebviewSessionItem | undefined {
  return state.sessions?.find((session) => session.path === path);
}

function findComposerState(harness: ManagerHarness, text: string): WebviewStateMessage | undefined {
  return harness.states.find((state) => state.composerText === text);
}

function lastState(harness: ManagerHarness): WebviewStateMessage {
  assert.ok(harness.states.length > 0, 'Expected at least one posted state');
  return harness.states[harness.states.length - 1];
}

class FakePiClient implements PiClient {
  public disposed = false;
  public readonly prompts: string[] = [];
  public readonly forkedEntries: string[] = [];
  public readonly sessionNames: string[] = [];
  private readonly eventListeners = new Set<(event: PiEvent) => void>();
  private readonly errorListeners = new Set<(message: string) => void>();

  public constructor(private readonly options: { state?: PiSessionState } = {}) {}

  public isRunning(): boolean {
    return !this.disposed;
  }

  public onEvent(listener: (event: PiEvent) => void): () => void {
    this.eventListeners.add(listener);

    return () => {
      this.eventListeners.delete(listener);
    };
  }

  public onError(listener: (message: string) => void): () => void {
    this.errorListeners.add(listener);

    return () => {
      this.errorListeners.delete(listener);
    };
  }

  public async prompt(message: string): Promise<void> {
    this.prompts.push(message);
  }

  public async abort(): Promise<void> {}

  public async reload(): Promise<void> {}

  public async getState(): Promise<PiSessionState> {
    return this.options.state ?? {
      model: { provider: 'openai', id: 'gpt-test', reasoning: false },
      thinkingLevel: 'off'
    };
  }

  public async getSessionStats(): Promise<PiSessionStats> {
    return {};
  }

  public async getAvailableModels(): Promise<{ models?: PiModel[] }> {
    return { models: [{ provider: 'openai', id: 'gpt-test', name: 'GPT Test', reasoning: false }] };
  }

  public async getCommands(): Promise<{ commands?: PiCommand[] }> {
    return { commands: [] };
  }

  public async setModel(): Promise<PiModel> {
    return {};
  }

  public async setThinkingLevel(): Promise<void> {}

  public async setSessionName(name: string): Promise<void> {
    this.sessionNames.push(name);
  }

  public async compact(): Promise<{}> {
    return {};
  }

  public async exportHtml(): Promise<{}> {
    return {};
  }

  public async getLastAssistantText(): Promise<{ text?: string | null }> {
    return { text: null };
  }

  public async getMessages(): Promise<{ messages?: PiAgentMessage[] }> {
    return { messages: [] };
  }

  public async switchSession(): Promise<{ cancelled?: boolean }> {
    return { cancelled: false };
  }

  public async getSessionTree(): Promise<WebviewTreeItem[]> {
    return [];
  }

  public async setTreeEntryLabel(): Promise<void> {}

  public async navigateTree(): Promise<{ editorText?: string; cancelled?: boolean; aborted?: boolean }> {
    return { cancelled: false };
  }

  public async getForkMessages(): Promise<{ messages?: Array<{ entryId?: string; text?: string }> }> {
    return { messages: [] };
  }

  public async fork(entryId: string): Promise<{ text?: string; cancelled?: boolean }> {
    this.forkedEntries.push(entryId);
    return { cancelled: false };
  }

  public async clone(): Promise<{ cancelled?: boolean }> {
    return { cancelled: false };
  }

  public dispose(): void {
    this.disposed = true;
  }

  public emit(event: PiEvent): void {
    for (const listener of [...this.eventListeners]) {
      listener(event);
    }
  }

  public emitError(message: string): void {
    for (const listener of [...this.errorListeners]) {
      listener(message);
    }
  }
}

async function flushPromises(): Promise<void> {
  await new Promise((resolve) => setImmediate(resolve));
}

async function wait(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}
