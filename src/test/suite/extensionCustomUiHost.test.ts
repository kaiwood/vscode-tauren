import * as assert from 'assert';
import { ExtensionCustomUiHost, type CustomUiHostMessage } from '../../extensionUi/customUiHost';

suite('ExtensionCustomUiHost', () => {
  test('renders, forwards input, and resolves from done callback', async () => {
    const messages: CustomUiHostMessage[] = [];
    const inputs: string[] = [];
    const host = new ExtensionCustomUiHost({
      isAvailable: () => true,
      postMessage: (message) => {
        messages.push(message);
        return true;
      },
      getOutputColors: () => true,
      notify: () => undefined
    });

    const resultPromise = host.custom<string>((_tui, _theme, _keybindings, done) => ({
      render: (width) => [`width:${width}`],
      handleInput: (data) => {
        inputs.push(data);
        done('answered');
      },
      invalidate: () => undefined
    }));
    await Promise.resolve();
    await Promise.resolve();

    const show = messages.find((message): message is { type: 'customUiShow'; id: string } => message.type === 'customUiShow');
    assert.ok(show);
    assert.deepStrictEqual(show, { type: 'customUiShow', id: show.id });
    assert.deepStrictEqual(messages.find((message) => message.type === 'customUiRender'), {
      type: 'customUiRender',
      id: show.id,
      lines: ['width:80'],
      outputColors: true
    });

    host.handleInput(show.id, '\r');

    assert.strictEqual(await resultPromise, 'answered');
    assert.deepStrictEqual(inputs, ['\r']);
    assert.deepStrictEqual(messages[messages.length - 1], { type: 'customUiHide', id: show.id });
  });

  test('marks explicitly requested custom UI overlays', async () => {
    const messages: CustomUiHostMessage[] = [];
    const host = new ExtensionCustomUiHost({
      isAvailable: () => true,
      postMessage: (message) => {
        messages.push(message);
        return true;
      },
      getOutputColors: () => true,
      notify: () => undefined
    });

    const resultPromise = host.custom<string>(() => ({
      render: () => ['overlay'],
      invalidate: () => undefined
    }), { overlay: true });
    await Promise.resolve();
    await Promise.resolve();

    const show = messages.find((message) => message.type === 'customUiShow');
    assert.ok(show);
    assert.deepStrictEqual(show, { type: 'customUiShow', id: show.id, overlay: true });

    host.cancel(show.id);
    assert.strictEqual(await resultPromise, undefined);
  });

  test('renders again after input and filters key releases unless requested', async () => {
    const messages: CustomUiHostMessage[] = [];
    const inputs: string[] = [];
    let value = '';
    const host = new ExtensionCustomUiHost({
      isAvailable: () => true,
      postMessage: (message) => {
        messages.push(message);
        return true;
      },
      getOutputColors: () => true,
      notify: () => undefined
    });

    const resultPromise = host.custom<string>(() => ({
      render: () => [value || '<empty>'],
      handleInput: (data) => {
        inputs.push(data);
        value += data;
      },
      invalidate: () => undefined
    }));
    await Promise.resolve();
    await Promise.resolve();

    const show = messages.find((message): message is { type: 'customUiShow'; id: string } => message.type === 'customUiShow');
    assert.ok(show);

    host.handleInput(show.id, 'x');
    await waitForRenderFrame();

    host.handleInput(show.id, '\x1b[120;1:3u');
    await waitForRenderFrame();

    assert.deepStrictEqual(inputs, ['x']);
    assert.ok(messages.some((message) => message.type === 'customUiRender' && message.lines[0] === 'x'));
    host.cancel(show.id);
    assert.strictEqual(await resultPromise, undefined);
  });

  test('coalesces repeated render invalidations to one frame', async () => {
    const messages: CustomUiHostMessage[] = [];
    let value = '';
    const host = new ExtensionCustomUiHost({
      isAvailable: () => true,
      postMessage: (message) => {
        messages.push(message);
        return true;
      },
      getOutputColors: () => true,
      notify: () => undefined
    });

    const resultPromise = host.custom<string>(() => ({
      render: () => [value || '<empty>'],
      handleInput: (data) => {
        value += data;
      },
      invalidate: () => undefined
    }));
    await Promise.resolve();
    await Promise.resolve();

    const show = messages.find((message): message is { type: 'customUiShow'; id: string } => message.type === 'customUiShow');
    assert.ok(show);

    host.handleInput(show.id, 'a');
    host.handleInput(show.id, 'b');
    host.handleInput(show.id, 'c');
    await waitForRenderFrame();

    const renderMessages = messages.filter((message) => message.type === 'customUiRender');
    assert.strictEqual(renderMessages.length, 2);
    assert.deepStrictEqual(renderMessages[1], {
      type: 'customUiRender',
      id: show.id,
      lines: ['abc'],
      outputColors: true
    });

    host.cancel(show.id);
    assert.strictEqual(await resultPromise, undefined);
  });

  test('sets focusable custom UI components focused while active', async () => {
    const messages: CustomUiHostMessage[] = [];
    let componentFocused = false;
    const component = {
      focused: false,
      render: () => {
        componentFocused = component.focused;
        return ['ready'];
      },
      invalidate: () => undefined
    };
    const host = new ExtensionCustomUiHost({
      isAvailable: () => true,
      postMessage: (message) => {
        messages.push(message);
        return true;
      },
      getOutputColors: () => true,
      notify: () => undefined
    });

    const resultPromise = host.custom<string>(() => component);
    await Promise.resolve();
    await Promise.resolve();

    const show = messages.find((message): message is { type: 'customUiShow'; id: string } => message.type === 'customUiShow');
    assert.ok(show);
    assert.strictEqual(componentFocused, true);
    assert.strictEqual(component.focused, true);

    host.cancel(show.id);

    assert.strictEqual(await resultPromise, undefined);
    assert.strictEqual(component.focused, false);
  });

  test('forwards key releases to components that opt in', async () => {
    const messages: CustomUiHostMessage[] = [];
    const inputs: string[] = [];
    const host = new ExtensionCustomUiHost({
      isAvailable: () => true,
      postMessage: (message) => {
        messages.push(message);
        return true;
      },
      getOutputColors: () => true,
      notify: () => undefined
    });

    const resultPromise = host.custom<string>(() => ({
      render: () => ['ready'],
      handleInput: (data) => {
        inputs.push(data);
      },
      wantsKeyRelease: true,
      invalidate: () => undefined
    }));
    await Promise.resolve();
    await Promise.resolve();

    const show = messages.find((message): message is { type: 'customUiShow'; id: string } => message.type === 'customUiShow');
    assert.ok(show);

    host.handleInput(show.id, '\x1b[120;1:3u');
    await new Promise((resolve) => setTimeout(resolve, 1));

    assert.deepStrictEqual(inputs, ['\x1b[120;1:3u']);
    host.cancel(show.id);
    assert.strictEqual(await resultPromise, undefined);
  });

  test('keeps custom UI alive while detached and restores on attach', async () => {
    const messages: CustomUiHostMessage[] = [];
    const inputs: string[] = [];
    let activeState: boolean | undefined;
    let value = 'initial';
    const host = new ExtensionCustomUiHost({
      isAvailable: () => true,
      postMessage: (message) => {
        messages.push(message);
        return true;
      },
      getOutputColors: () => true,
      notify: () => undefined,
      onActiveChange: (active) => {
        activeState = active;
      }
    });

    const resultPromise = host.custom<string>(() => ({
      render: () => [value],
      handleInput: (data) => {
        inputs.push(data);
        value = data;
      },
      invalidate: () => undefined
    }));
    await Promise.resolve();
    await Promise.resolve();

    const show = messages.find((message): message is { type: 'customUiShow'; id: string } => message.type === 'customUiShow');
    assert.ok(show);
    assert.strictEqual(activeState, true);

    host.setAttached(false);
    host.handleInput(show.id, 'hidden');
    await new Promise((resolve) => setTimeout(resolve, 1));
    host.setAttached(true);

    assert.deepStrictEqual(inputs, ['hidden']);
    assert.deepStrictEqual(messages.filter((message) => message.type === 'customUiHide'), [{ type: 'customUiHide', id: show.id }]);
    assert.ok(messages.some((message) => message.type === 'customUiRender' && message.id === show.id && message.lines[0] === 'hidden'));

    host.cancel(show.id);
    assert.strictEqual(await resultPromise, undefined);
    assert.strictEqual(activeState, false);
  });

  test('updates dimensions and cancels active UI', async () => {
    const messages: CustomUiHostMessage[] = [];
    let disposed = false;
    const host = new ExtensionCustomUiHost({
      isAvailable: () => true,
      postMessage: (message) => {
        messages.push(message);
        return true;
      },
      getOutputColors: () => false,
      notify: () => undefined
    });

    const resultPromise = host.custom<string>(() => ({
      render: (width) => [`width:${width}`],
      invalidate: () => undefined,
      dispose: () => {
        disposed = true;
      }
    }));
    await Promise.resolve();
    await Promise.resolve();

    const show = messages.find((message): message is { type: 'customUiShow'; id: string } => message.type === 'customUiShow');
    assert.ok(show);

    host.updateDimensions(show.id, 100, 20);
    await waitForRenderFrame();
    host.cancel(show.id);

    assert.strictEqual(await resultPromise, undefined);
    assert.strictEqual(disposed, true);
    assert.ok(messages.some((message) => message.type === 'customUiRender' && message.lines[0] === 'width:100'));
    assert.deepStrictEqual(messages[messages.length - 1], { type: 'customUiHide', id: show.id });
  });
});

function waitForRenderFrame(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 25));
}
