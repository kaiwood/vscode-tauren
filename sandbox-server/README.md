# Tauren sandbox server

Private standalone Node project for the SBX SDK server. Step 2 establishes the
wire contract and transport tests only; there is no executable SDK server yet.
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

See [protocol and parity checklist](docs/protocol.md).
