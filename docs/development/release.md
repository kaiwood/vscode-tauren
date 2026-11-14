# Release Process

This page captures the practical release flow for Tauren contributors.

## Before release

1. Review `CHANGELOG.md` and move relevant Unreleased entries into the release section.
2. Run compile and tests.
3. Package the extension.
4. Install the VSIX locally and smoke test the sidebar.
5. Set `OVSX_PAT` to an Open VSX personal access token in the release shell. Keep the token in a secure local secret store or environment configuration; never commit it.

Verify the token can publish to Tauren's Open VSX namespace before the first release and whenever the token changes:

```sh
npx --yes ovsx verify-pat kaiwood
```

The release script also performs this check before it changes any release files.

## Useful commands

Compile everything:

```sh
npm run compile
```

Run tests:

```sh
npm test
```

Verify the generated sandbox kits and run the real SDK server from an extracted
VSIX, outside the checkout:

```sh
npm run test:sandbox-package
```

This builds Tauren's extension-host SDK runtime and the sandbox server adapter,
then collects a real VSIX. The server mixin bundles server/shared/JSON-RPC code,
not a second SDK runtime, SDK assets, Jiti, or extension peer shims. Its
`dist/sandboxPi.js` resolver loads the sandbox's existing Pi public SDK through
the first `pi` on `PATH`. The separate generated default Pi descriptor is retained;
production kits remain v2 and shell-test kits remain v3.

The test provisions an independent installed Pi tree outside the checkout and
exposes its correct CLI through a symlink on an isolated test `PATH`. It verifies
missing/incompatible Pi rejection, the actual loaded SDK version in the handshake,
and offline tools/UI, persistence and HTML export. Standalone development tests
continue using the server's pinned SDK normally. The extracted-VSIX gate passes;
it requires `unzip` and the VSIX packaging tool, with no external model calls.
For an already-built artifact, avoid packaging again:

```sh
TAUREN_TEST_VSIX=/absolute/path/tauren.vsix node --test scripts/sandbox-package.test.js
```

Release preflight runs the local extracted-artifact test against its preflight
VSIX. This does not verify real-SBX installation: packaged end-to-end validation
remains a separate later gate on a provisioned host, and shell-kit transport tests
do not replace it. The source-kit installation probe remains available through
`npm run test:sbx-kit:smoke`; there is no `test:sandbox-package:sbx` command.

Build and install a local VSIX:

```sh
npm run install:local
```

Publish a release to GitHub, the VS Code Marketplace, and Open VSX:

```sh
npm run publish -- <version>
```

For example:

```sh
npm run publish -- 1.10.0
```

`npm run release -- <version>` remains an alias for this command. Open VSX receives the prebuilt release VSIX, authenticated with `OVSX_PAT`.

## Manual checks

At minimum, verify:

- sidebar opens,
- Pi starts and model metadata refreshes,
- a prompt streams text,
- Stop works during a response,
- session list opens,
- session diff opens after a file edit,
- settings open,
- extension custom UI still renders if the release touched bridge code.

## Documentation checks

For docs changes:

```sh
npm run docs:build
git diff --check
```

The docs site is deployed to GitHub Pages by `.github/workflows/docs.yml` after changes are pushed to `main`.
