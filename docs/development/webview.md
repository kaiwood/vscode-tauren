# Webview

Tauren's UI is a VS Code webview backed by browser code in `src/webview`.

## Host and browser split

The extension host creates and manages the webview. Browser code handles DOM interaction inside the sidebar.

Host-side files:

- `src/sidebar/chatWebview.ts` builds the webview HTML.
- `src/sidebar/chatWebviewStyles.ts` and `src/sidebar/styles/` define static CSS.
- `src/sidebar/nonce.ts` creates CSP nonces.
- `src/webviewProtocol/types.ts` defines shared messages and state.

Browser-side files:

- `src/webview/main.ts` is the ready/composition entrypoint.
- `src/webview/composer/` owns prompt input behavior.
- `src/webview/messages/` owns transcript rendering.
- `src/webview/sessions/` owns session list and tree UI.
- `src/webview/settings/` owns settings UI.
- `src/webview/customUI/` owns Pi extension custom UI rendering.

## Bundling

Browser code is bundled with esbuild:

```sh
npm run compile:webview
```

The output is:

```text
resources/webview/chat.js
```

Generated first-party webview assets belong under `resources/webview`. Vendored browser-only libraries live under `resources/vendor`.

## Debugging

Start the **Run Extension** debug configuration to build the webview with an inline source map and debug the TypeScript files under `src/webview` directly.

For rebuilds while the Extension Host is running, enable source maps when starting the watcher:

```sh
TAUREN_WEBVIEW_SOURCEMAP=1 npm run watch
```

Normal builds omit the source map unless `TAUREN_WEBVIEW_SOURCEMAP` is set to `1`.

## Rendering expectations

The webview should feel VS Code-native:

- use VS Code CSS variables,
- preserve keyboard-first workflows,
- keep code readable when syntax highlighting fails,
- avoid broad frontend rewrites without a clear goal,
- do not queue follow-up prompts while Pi is streaming.

## Markdown and highlighting

Markdown rendering lives under `src/webview/messages/`. Syntax highlighting is done asynchronously by extension-host Shiki code in `src/highlighting/shikiCodeRenderer.ts`.

If highlighting fails, code must remain readable as plain text.

## Protocol changes

When adding webview messages or state:

1. update shared types in `src/webviewProtocol/types.ts`,
2. update host-side parsing/dispatch,
3. update browser-side handling,
4. add tests for parsing or behavior where practical.
