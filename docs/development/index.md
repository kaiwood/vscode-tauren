# Development

This section is for contributors working on Tauren itself.

Start with:

- [Architecture](./architecture.md)
- [UI Language](./ui-language.md)
- [Pi Integration](./pi-integration.md)
- [SBX Mixin Installation Contract](./sbx-kit.md)
- [Webview](./webview.md)
- [Diff Lifecycle](./diff-lifecycle.md)

For major architectural choices, read the [decision records](../decisions/0001-sdk-over-rpc.md).

## Local development

```sh
npm install
npm run compile
```

## Running tests

Install the standalone server's dependencies as well as the root dependencies:

```sh
npm ci --prefix sandbox-server
npm test
```

Root `npm test` runs the standalone server/version checks, compiles the extension,
then runs its VS Code Extension Host tests. The server tests need no VS Code,
SBX, SSH, model service, or credentials and can also run independently:

```sh
npm run test:sandbox-server
```

### Headless Linux

The VS Code test process requires a display. On a headless Linux machine, install
Xvfb and run the suite through a virtual display:

```sh
# Debian/Ubuntu (one-time prerequisite):
sudo apt-get install xvfb
xvfb-run -a npm test
```

`-a` selects an available display number. Without a graphical session or Xvfb,
VS Code may exit with `Missing X server or $DISPLAY` before any extension tests
run. A virtual display does not provide desktop services such as Trash; tests
should stub those services rather than depend on the host desktop.

The VS Code test runner may download its test installation, so an initial run
also requires network access. Real-SBX smoke tests remain explicitly invoked
with `npm run test:sbx-kit:smoke`; they are not part of `npm test`.

For documentation changes:

```sh
npm run docs:dev
npm run docs:build
```
