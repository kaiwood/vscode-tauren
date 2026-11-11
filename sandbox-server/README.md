# Tauren sandbox server

Private standalone Node project for the SBX SDK server. The executable supports
initialization, basic state/history queries, text-only idle prompts, SDK events,
and bounded shutdown. Other runtime/session/UI methods remain later increments.
This package is not independently published and imports no extension-host code.

```sh
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
files. Production bundling and VSIX inclusion are step 7, not part of this increment.

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
configuration, stderr isolation, and cleanup during generation. No special test
mode or fixture branch exists in production startup.

See [protocol and parity checklist](docs/protocol.md).
