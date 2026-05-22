import * as assert from 'assert';
import { CustomUiController, isTextInputKeyboardEvent, terminalDataForKeyboardEvent } from '../../webview/customUI/customUi';

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
