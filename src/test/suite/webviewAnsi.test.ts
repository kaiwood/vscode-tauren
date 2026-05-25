import * as assert from 'assert';
import { getAnsiBlockImageCells, getAnsiFullWidgetBackground, getAnsiLineBackground, isAnsiBlockImageLine } from '../../webview/messages/ansi';

suite('Webview ANSI helpers', () => {
  test('promotes a uniform full-widget background', () => {
    const background = getAnsiFullWidgetBackground([
      '\x1b[42mfirst line',
      '',
      '\x1b[42msecond line\x1b[0m'
    ], true);

    assert.ok(background?.includes('ansiGreen'));
  });

  test('promotes despite uncolored whitespace padding', () => {
    const background = getAnsiFullWidgetBackground([
      '\x1b[42mfirst line\x1b[0m    ',
      '  \x1b[42msecond line\x1b[0m  '
    ], true);

    assert.ok(background?.includes('ansiGreen'));
  });

  test('promotes a uniform line background', () => {
    const background = getAnsiLineBackground('\x1b[42mfull line\x1b[0m   ', true);

    assert.ok(background?.includes('ansiGreen'));
  });

  test('does not promote mixed line backgrounds', () => {
    assert.strictEqual(getAnsiLineBackground('\x1b[42mgreen\x1b[41mred\x1b[0m', true), undefined);
  });

  test('does not promote mixed full-widget backgrounds', () => {
    assert.strictEqual(getAnsiFullWidgetBackground([
      '\x1b[42mfirst line',
      '\x1b[41msecond line'
    ], true), undefined);
  });

  test('does not promote partially colored widget lines', () => {
    assert.strictEqual(getAnsiFullWidgetBackground([
      '\x1b[42mcolored\x1b[0m plain'
    ], true), undefined);
  });

  test('does not promote widgets without background colors', () => {
    assert.strictEqual(getAnsiFullWidgetBackground([
      'plain line',
      '\x1b[32mforeground only'
    ], true), undefined);
  });

  test('detects ANSI block image lines', () => {
    const line = '\x1b[38;2;199;203;145m\x1b[48;2;158;163;107m▀\x1b[38;2;237;237;220m\x1b[48;2;205;204;168m▀\x1b[0m';

    assert.strictEqual(isAnsiBlockImageLine(line), true);
    assert.strictEqual(isAnsiBlockImageLine('\x1b[32mnormal text\x1b[0m'), false);
    assert.strictEqual(isAnsiBlockImageLine('▀▀▀'), false);
  });

  test('maps ANSI block image glyphs to terminal cell halves', () => {
    const cells = getAnsiBlockImageCells('\x1b[38;2;70;91;113m\x1b[48;2;141;82;57m▀▄█ \x1b[0m', true);

    assert.deepStrictEqual(cells, [
      { top: 'rgb(70, 91, 113)', bottom: 'rgb(141, 82, 57)' },
      { top: 'rgb(141, 82, 57)', bottom: 'rgb(70, 91, 113)' },
      { top: 'rgb(70, 91, 113)', bottom: 'rgb(70, 91, 113)' },
      { top: 'rgb(141, 82, 57)', bottom: 'rgb(141, 82, 57)' }
    ]);
    assert.strictEqual(getAnsiBlockImageCells('\x1b[32mnormal text\x1b[0m', true), undefined);
    assert.strictEqual(getAnsiBlockImageCells('\x1b[32m▀\x1b[0m', false), undefined);
  });

  test('does not promote when output colors are disabled', () => {
    assert.strictEqual(getAnsiFullWidgetBackground([
      '\x1b[42mfirst line',
      '\x1b[42msecond line'
    ], false), undefined);
  });
});
