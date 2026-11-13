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
npm ci --prefix shared
npm run compile
```

## Running tests

Install the standalone server's dependencies as well as the root dependencies:

```sh
npm ci --prefix sandbox-server
npm test
```

Root `npm test` runs the shared-package and standalone server/version checks, compiles the extension,
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

### Opt-in SBX SSH integration

The remote-pipe suite creates a disposable SBX **shell** sandbox and runs the
built server over `ssh -T`. It is excluded from ordinary `npm test`; no local
`sshd`, temporary authentication keys, or OS account changes are required.
Run it on a host with SBX login and SSH setup complete, an SSH client, and a
version supporting the built-in v3 shell kit. The fixture composes its v3 Node mixin to install
Node 22.22.1; it does not rely on the shell image's Node version:

```sh
npm run test:sandbox-server:sbx
```

### Aggregate local and SBX regression gate

On a host with both the Extension Host and SBX prerequisites, run:

```sh
npm run test:all
# Headless Linux:
xvfb-run -a npm run test:all
```

This runs `npm test` first, then `test:sandbox-server:sbx`, stopping if either
fails. It is the combined regression gate for server/transport changes; ordinary
`npm test` remains usable without SBX. Kit-installation smoke tests and future
packaged end-to-end gates remain separate, not implicitly included in `test:all`.

The fixture mounts prepared code read-only and uses a separate writable workspace
for settings, sessions and tool targets. It checks remote process cleanup before
removing the sandbox. See `sandbox-server/README.md` in the repository for
runtime/dependency prerequisites and `SBX_PATH`/`SSH_PATH` overrides.

The VS Code test runner may download its test installation, so an initial run
also requires network access. Real-SBX smoke tests remain explicitly invoked
with `npm run test:sbx-kit:smoke`; they are not part of `npm test`.

For documentation changes:

```sh
npm run docs:dev
npm run docs:build
```
