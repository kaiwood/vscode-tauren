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
