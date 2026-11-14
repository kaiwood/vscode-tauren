# Tauren sandbox server

Private standalone Node project for the SBX SDK server. The executable supports
initialization, state/history queries, streaming prompts with images and Pi-owned
steering/follow-up, abort, model/settings/resource controls, file completions,
credential-policy enforcement, session/tree/import/export operations, remote
extension UI, and bounded shutdown. Generated-kit packaging and standalone SSH
tests are implemented; Tauren's SSH transport and host adapter remain later increments.
This package is not independently published and imports no extension-host code.

```sh
npm ci --prefix shared
npm ci --prefix sandbox-server
npm run compile:sandbox-server
npm run test:sandbox-server
node --test scripts/verify-sandbox-sdk-version.test.js
```

Or run `npm run build` / `npm test` inside this directory. These commands require
no VS Code, SSH, SBX, model credentials, or model network calls. Installing npm
dependencies is a separate network-dependent prerequisite.

The SDK dependency is pinned to an exact release for reproducible installs.
The root version guard compares it with the extension's resolved SDK in
`package-lock.json`: stable major/minor must match, patches may differ, and
prereleases must match exactly. The guard also checks the server manifest/lock
and installed version consistency. Root SDK compilation and verification run
this guard, so SDK updates cannot silently cross a release line.

`@tauren/sandbox-server/protocol` exports the built, VS Code-independent contract
and connection helper. A future host adapter can consume this package subpath
without importing extension code into the server. Its ESM output can be imported
from Node 22 or dynamically from the CommonJS extension. The build emits `.d.ts`
files. Root `npm run compile` also bundles the server adapter into the generated
server mixin and stages the default sandbox descriptor as a separate kit. The
pinned SDK remains the dependency for standalone development and tests; the
packaged server instead loads the sandbox's existing Pi installation.

## Generated production kits

`npm run compile:sbx-kit` builds this project and generates two separate resources:

- `resources/generated-sbx-kit/`: server mixin `spec.yaml`, build manifest and
  server entrypoint at `files/home/.tauren/server/dist/main.js` and installed-Pi
  resolver at `files/home/.tauren/server/dist/sandboxPi.js`.
- `resources/generated-sbx-sandbox/`: standalone Pi `spec.yaml`, with the configured
  runtime image digest interpolated and source provenance retained.

Only server code, shared helpers and JSON-RPC are bundled; there is no second Pi
SDK runtime, copied SDK assets, Jiti runtime, or generated extension peer shims.
The resolver selects the first executable `pi` on the sandbox's `PATH`, follows
its symlink with `realpath`, and walks parent directories to the package named
`@earendil-works/pi-coding-agent`. It loads that package's public root SDK export
(`exports['.'].import`, or a string root export), never a private SDK path or CLI
subprocess. An unusable first Pi fails rather than selecting another installation.

The server's `package.json` records `sandboxPiSdkVersion` as the compatibility
baseline: stable major/minor must match, patches may differ, and prereleases must
match exactly. The loaded SDK's `VERSION` must match its package metadata; the
handshake reports that actual loaded version, not the build-time baseline. Assets,
Jiti and extension peers retain the existing Pi package's unchanged layout and
module identity. No sandbox-side npm install or checkout dependency is required.
Root clean removes generated kit/server output. Source descriptors remain under
`resources/sbx-kit`; production Pi kits remain v2, distinct from the v3 shell-test kits.

`npm run test:sandbox-package` extracts a real VSIX and exercises the server
outside the checkout with an independently provisioned installed Pi tree. An
isolated test `PATH` exposes a `pi` symlink to that tree's correct CLI entrypoint.
The passing gate verifies missing/incompatible Pi rejection, the loaded handshake
version, offline tools/UI, persistence and HTML export, without borrowing checkout
dependencies in the server process. This is not a real-SBX installation test;
packaged end-to-end SBX verification remains a later gate.

## Running the stdio server

After building, launch `node sandbox-server/dist/main.js` (or `npm start` inside
this project). Connect framed JSON-RPC to stdin/stdout, then send `initialize`
with protocol/client versions, an absolute workspace, an absolute session directory
outside that workspace, and optionally a persisted session file inside the store.
The handshake reports effective canonical paths, Pi/server versions, and implemented
capabilities. This does not start SSH or create a sandbox.

`shutdown` aborts active SDK work and acknowledges after runtime disposal. Close
stdin after receiving the acknowledgement. EOF/disconnect or SIGTERM also triggers
cleanup; a five-second deadline prevents an uncooperative runtime or peer from
hanging shutdown. A deadline failure exits nonzero. Console diagnostics go to
stderr; stdout is reserved for framed messages.

Subprocess tests launch this same entrypoint with an ordinary fixture provider
extension discovered through isolated Pi settings. They exercise the real SDK,
not mocks, without credentials or model network access. They verify streaming,
`rpc` prompt source, persistence and reopening after process restart, invalid
configuration, stderr isolation, real read/write/edit/bash tools, cancellation,
steering/follow-up, runtime settings persistence, file completion handles,
credential rejection, and descendant-process cleanup during tools/generation.
No special test mode or fixture branch exists in production startup.

Prompt requests acknowledge SDK preflight acceptance. Cancellation of an
unacknowledged request cancels that preflight/run; after acknowledgement use
`chat.abort`. Extension input hooks themselves have no cancellation signal, so
cleanup also tracks pending prompts and re-applies abort when a delayed hook
starts its run. The shutdown deadline remains the fallback for uncooperative
extensions. Pi owns the queues and tool process groups; the server does not
introduce another scheduler or shell runner.

`auth.getProviders` exposes sanitized readiness only. Login, OAuth, and logout
requests always fail with `CredentialPolicy`; no credential records or write
APIs cross the protocol. Model metadata omits configured HTTP headers. Trusted
Pi extensions and tools retain normal SDK behavior inside the sandbox; this
wire policy is not a filesystem security boundary against sandbox code.

## Sessions and extension UI

`sessionControls.ts` delegates session replacement to `AgentSessionRuntime`,
rebinds event/UI callbacks, and reconstructs history from Pi session files.
Switches remain in the initialized store/workspace; imports copy normalized JSONL
into that store. Discovery/origin scans do not fall back to `~/.pi`. Export returns
both the server-side path and HTML content; the future host adapter must materialize
that content and apply host-side export presentation.

`extensionUi/` keeps component factories, callbacks, terminal handlers and custom
`done(T)` values beside the SDK. The wire carries dialogs, opaque surface handles,
rendered text/image blocks, input and UI intent. Reverse requests are cancelled
on timeout, abort, reset or disconnect; late factory results are disposed rather
than remounted. The in-process Tauren bridge's documented terminal-only no-ops
are preserved, including the empty composer-text getter and unsupported theme
switching/editor replacement. This is not a new terminal implementation.

Server modules import helper subpaths directly from the local `@tauren/shared`
package under `shared/`. Both consumers use one maintained helper implementation;
its ESM/CJS outputs avoid importing extension-host code or staging source copies.
The server build builds that dependency first. See `shared/README.md`.
Real-SDK subprocess tests cover UI round trips, server-local completion values,
provider registration, custom renderers, persisted branches, compaction, and
session replacement. They do not verify VS Code rendering or SSH/SBX behavior.

## SBX shell-sandbox SSH tests

```sh
npm run test:sandbox-server:sbx  # repository root
# or: npm run test:sbx inside sandbox-server
```

This slower gate is **not included in root `npm test`**. Run it on a host with
Docker Sandboxes, `sbx login`, `sbx setup ssh`, and an SSH client already available.
It creates a unique disposable sandbox using SBX's built-in v3 `shell` kit and
automatically composes the v3 `test-resources/node-shell-mixin`. It starts the sandbox with detached `sbx run`
and removes it in cleanup. No local SSH daemon,
key generation, privileged setup, or OS account changes are needed: SBX supplies
the SSH endpoint. `SBX_PATH` and `SSH_PATH` optionally select the executables.

`src/test/sbxShellFixture.ts` stages the built server/dependencies/fixture extensions
in a separate read-only additional workspace (`PATH:ro`). Its writable primary
workspace holds isolated settings, session files, tool targets and PID markers.
The code payload is not nested under a writable mount. Dependencies are
materialized, including the local shared package, rather than linking back into
the checkout. This is test payload assembly, not production kit installation.

The test-only Node mixin installs pinned Node 22.22.1 during sandbox creation;
the fixture verifies and uses `/opt/tauren-test-node/bin/node`, never the base
image's Node or the host's executable. Creation requires access to nodejs.org.
The shell base must provide curl, tar/gzip, sha256sum, and glibc Linux. The mixin
uses v3 lifecycle and install-only network-policy capabilities; no custom shell
kit setting is needed. See `test-resources/node-shell-mixin/README.md`.

Dependencies must be Linux/architecture-compatible; use a compatible installation
when staging from a non-Linux host. Read-only enforcement is checked remotely.
The test Node mixin is separate from Tauren's Pi-specific production mixin.

Every protocol connection uses `ssh -T <name>.sbx`, no connection sharing or local
shell. Remote launch commands use `@tauren/shared/ssh/serverLaunch`; POSIX remote
quoting is distinct from local argv. The tests explicitly isolate the remote
environment and supply workspace/session paths, not SSH environment forwarding
or interactive profile initialization.

SSH tests run the built production entrypoint with ordinary offline provider/UI
extensions, test literal metacharacter paths, and observe recorded server/tool
PIDs during disconnect. Fixture cleanup is only a safety net, not the proof of
server cleanup. Reconnection reopens history without replaying interrupted tools.
PID checks/signals execute inside the VM over separate SSH probes, never against
host PIDs. Sandbox removal is final cleanup, not proof of disconnect behavior.
This exercises the actual SBX SSH boundary; Tauren kit installation, production
packaging, sandbox adoption, and full host integration remain separate gates.

See [protocol and parity checklist](docs/protocol.md).
