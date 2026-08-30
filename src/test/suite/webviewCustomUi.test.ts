import * as assert from 'assert';
import { CustomUiController, isTextInputKeyboardEvent, prepareCustomUiLines, terminalDataForKeyboardEvent } from '../../webview/customUI/customUi';

suite('Webview custom UI keyboard helpers', () => {
  test('keeps legacy terminal data for key press compatibility', () => {
    assert.strictEqual(terminalDataForKeyboardEvent(keyEvent({ key: 'Enter' })), '\r');
    assert.strictEqual(terminalDataForKeyboardEvent(keyEvent({ key: 'ArrowUp' })), '\x1b[A');
    assert.strictEqual(terminalDataForKeyboardEvent(keyEvent({ key: 'c', ctrlKey: true })), '\x03');
    assert.strictEqual(terminalDataForKeyboardEvent(keyEvent({ key: 'x', altKey: true })), '\x1bx');
  });

  test('encodes repeats and releases as Kitty-compatible strings', () => {
    assert.strictEqual(terminalDataForKeyboardEvent(keyEvent({ key: 'w' }), 'release'), '\x1b[119;1:3u');
    assert.strictEqual(terminalDataForKeyboardEvent(keyEvent({ key: 'W', shiftKey: true }), 'release'), '\x1b[87;2:3u');
    assert.strictEqual(terminalDataForKeyboardEvent(keyEvent({ key: 'ArrowUp' }), 'repeat'), '\x1b[1;1:2A');
    assert.strictEqual(terminalDataForKeyboardEvent(keyEvent({ key: 'ArrowUp' }), 'release'), '\x1b[1;1:3A');
    assert.strictEqual(terminalDataForKeyboardEvent(keyEvent({ key: ' ', ctrlKey: true }), 'release'), '\x1b[32;5:3u');
  });

  test('detects plain text keys that should be handled by beforeinput', () => {
    assert.strictEqual(isTextInputKeyboardEvent(keyEvent({ key: 'a' })), true);
    assert.strictEqual(isTextInputKeyboardEvent(keyEvent({ key: 'é' })), true);
    assert.strictEqual(isTextInputKeyboardEvent(keyEvent({ key: 'a', ctrlKey: true })), false);
    assert.strictEqual(isTextInputKeyboardEvent(keyEvent({ key: 'a', altKey: true })), false);
    assert.strictEqual(isTextInputKeyboardEvent(keyEvent({ key: 'Enter' })), false);
  });

  test('extracts CURSOR_MARKER position from rendered custom UI lines', () => {
    const prepared = prepareCustomUiLines(['\x1b[36mab\x1b[0mc\x1b_pi:c\x07d']);

    assert.deepStrictEqual(prepared.lines, ['\x1b[36mab\x1b[0mcd']);
    assert.deepStrictEqual(prepared.cursor, { row: 0, column: 3 });
  });

  test('does not synthesize a fallback cursor for markerless custom UI lines', () => {
    const prepared = prepareCustomUiLines(['first', '', '\x1b[90mlast\x1b[0m']);

    assert.deepStrictEqual(prepared.lines, ['first', '', '\x1b[90mlast\x1b[0m']);
    assert.strictEqual(prepared.cursor, undefined);
  });

  test('docks normal custom UI and only floats explicit overlays', () => {
    const originalRequestAnimationFrame = globalThis.requestAnimationFrame;

    try {
      (globalThis as unknown as { requestAnimationFrame: typeof requestAnimationFrame }).requestAnimationFrame = (() => 7) as typeof requestAnimationFrame;
      const form = fakeElement();
      const customUiElement = fakeElement();
      let showCount = 0;
      const controller = new CustomUiController({
        vscode: { postMessage: () => undefined },
        customUiElement,
        customUiOutputElement: fakeElement(),
        customUiCloseButton: fakeElement() as HTMLButtonElement,
        form: form as HTMLFormElement,
        onShow: () => {
          showCount += 1;
        }
      });
      (controller as unknown as { inputCaptureElement: HTMLTextAreaElement }).inputCaptureElement = {
        value: '',
        style: {},
        focus: () => undefined
      } as unknown as HTMLTextAreaElement;

      assert.strictEqual(controller.handleHostMessage({ type: 'customUiShow', id: 'custom-1' }), true);
      assert.strictEqual(customUiElement.classList.contains('custom-ui--overlay'), false);
      assert.strictEqual(form.classList.contains('composer--custom-replaced'), true);
      assert.strictEqual(form.classList.contains('composer--custom-hidden'), false);

      assert.strictEqual(controller.handleHostMessage({ type: 'customUiHide', id: 'custom-1' }), true);
      assert.strictEqual(form.classList.contains('composer--custom-replaced'), false);

      assert.strictEqual(controller.handleHostMessage({ type: 'customUiShow', id: 'custom-2', overlay: true }), true);
      assert.strictEqual(customUiElement.classList.contains('custom-ui--overlay'), true);
      assert.strictEqual(form.classList.contains('composer--custom-replaced'), false);
      assert.strictEqual(form.classList.contains('composer--custom-hidden'), true);
      assert.strictEqual(showCount, 2);

      assert.strictEqual(controller.handleHostMessage({ type: 'customUiShow', id: 'invalid', overlay: 'yes' }), false);
    } finally {
      (globalThis as unknown as { requestAnimationFrame: typeof requestAnimationFrame }).requestAnimationFrame = originalRequestAnimationFrame;
    }
  });

  test('notifies when active custom UI hides', () => {
    const form = fakeElement();
    const customUiElement = fakeElement();
    const customUiOutputElement = fakeElement();
    let closeCount = 0;
    const controller = new CustomUiController({
      vscode: { postMessage: () => undefined },
      customUiElement,
      customUiOutputElement,
      customUiCloseButton: fakeElement() as HTMLButtonElement,
      form: form as HTMLFormElement,
      onClose: () => {
        closeCount += 1;
      }
    });

    (controller as unknown as { activeId: string }).activeId = 'custom-1';

    assert.strictEqual(controller.handleHostMessage({ type: 'customUiHide', id: 'custom-1' }), true);
    assert.strictEqual(closeCount, 1);
    assert.strictEqual(customUiElement.hidden, true);
    assert.strictEqual(form.inert, false);
  });

  test('keeps custom UI text capture focused while active', () => {
    let focusCount = 0;
    const inputCaptureElement = {
      value: 'stale',
      focus: () => {
        focusCount += 1;
      }
    } as unknown as HTMLTextAreaElement;
    const controller = new CustomUiController({
      vscode: { postMessage: () => undefined },
      customUiElement: fakeElement(),
      customUiOutputElement: fakeElement(),
      customUiCloseButton: fakeElement() as HTMLButtonElement,
      form: fakeElement() as HTMLFormElement
    });

    (controller as unknown as { activeId: string; inputCaptureElement: HTMLTextAreaElement }).activeId = 'custom-1';
    (controller as unknown as { inputCaptureElement: HTMLTextAreaElement }).inputCaptureElement = inputCaptureElement;

    assert.strictEqual(controller.focusInput(), true);
    assert.strictEqual(inputCaptureElement.value, '');
    assert.strictEqual(focusCount, 1);

    assert.strictEqual(controller.handleGlobalKeydown(keyEvent({ key: 'a' })), true);
    assert.strictEqual(focusCount, 2);
  });

  test('does not notify for stale custom UI hide messages', () => {
    let closeCount = 0;
    const controller = new CustomUiController({
      vscode: { postMessage: () => undefined },
      customUiElement: fakeElement(),
      customUiOutputElement: fakeElement(),
      customUiCloseButton: fakeElement() as HTMLButtonElement,
      form: fakeElement() as HTMLFormElement,
      onClose: () => {
        closeCount += 1;
      }
    });

    (controller as unknown as { activeId: string }).activeId = 'custom-1';

    assert.strictEqual(controller.handleHostMessage({ type: 'customUiHide', id: 'custom-2' }), true);
    assert.strictEqual(closeCount, 0);
  });

  test('coalesces custom UI render messages to one animation frame', () => {
    const originalRequestAnimationFrame = globalThis.requestAnimationFrame;
    const originalCancelAnimationFrame = globalThis.cancelAnimationFrame;
    let requestCount = 0;
    let canceledFrame: number | undefined;

    try {
      (globalThis as unknown as { requestAnimationFrame: typeof requestAnimationFrame }).requestAnimationFrame = (() => {
        requestCount += 1;
        return 7;
      }) as typeof requestAnimationFrame;
      (globalThis as unknown as { cancelAnimationFrame: typeof cancelAnimationFrame }).cancelAnimationFrame = ((handle: number) => {
        canceledFrame = handle;
      }) as typeof cancelAnimationFrame;

      const controller = new CustomUiController({
        vscode: { postMessage: () => undefined },
        customUiElement: fakeElement(),
        customUiOutputElement: fakeElement(),
        customUiCloseButton: fakeElement() as HTMLButtonElement,
        form: fakeElement() as HTMLFormElement
      });

      (controller as unknown as { activeId: string }).activeId = 'custom-1';

      assert.strictEqual(controller.handleHostMessage({ type: 'customUiRender', id: 'custom-1', lines: ['first'] }), true);
      assert.strictEqual(controller.handleHostMessage({ type: 'customUiRender', id: 'custom-1', lines: ['latest'], outputColors: false }), true);

      const scheduled = controller as unknown as {
        pendingRender?: { lines: string[]; outputColors: boolean };
        renderFrame?: number;
      };
      assert.strictEqual(requestCount, 1);
      assert.deepStrictEqual(scheduled.pendingRender, { id: 'custom-1', lines: ['latest'], outputColors: false });
      assert.strictEqual(scheduled.renderFrame, 7);

      assert.strictEqual(controller.handleHostMessage({ type: 'customUiHide', id: 'custom-1' }), true);
      assert.strictEqual(canceledFrame, 7);
      assert.strictEqual(scheduled.pendingRender, undefined);
      assert.strictEqual(scheduled.renderFrame, undefined);
    } finally {
      (globalThis as unknown as { requestAnimationFrame: typeof requestAnimationFrame }).requestAnimationFrame = originalRequestAnimationFrame;
      (globalThis as unknown as { cancelAnimationFrame: typeof cancelAnimationFrame }).cancelAnimationFrame = originalCancelAnimationFrame;
    }
  });
});

type KeyEventOptions = {
  key: string;
  altKey?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
  shiftKey?: boolean;
};

function keyEvent(options: KeyEventOptions): KeyboardEvent {
  return {
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    ...options
  } as KeyboardEvent;
}

function fakeElement(): HTMLElement {
  const attributes = new Map<string, string>();
  const classNames = new Set<string>();
  const element = {
    hidden: false,
    inert: false,
    classList: {
      add: (...tokens: string[]) => tokens.forEach((token) => classNames.add(token)),
      remove: (...tokens: string[]) => tokens.forEach((token) => classNames.delete(token)),
      toggle: (token: string, force?: boolean) => {
        const enabled = force ?? !classNames.has(token);
        if (enabled) {
          classNames.add(token);
        } else {
          classNames.delete(token);
        }
        return enabled;
      },
      contains: (token: string) => classNames.has(token)
    } as unknown as DOMTokenList,
    setAttribute: (name: string, value: string) => {
      attributes.set(name, value);
    },
    removeAttribute: (name: string) => {
      attributes.delete(name);
    },
    replaceChildren: () => undefined,
    append: () => undefined,
    focus: () => undefined
  };

  return element as unknown as HTMLElement;
}
