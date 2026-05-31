# Release Process

This page captures the practical release flow for Tauren contributors.

## Before release

1. Review `CHANGELOG.md` and move relevant Unreleased entries into the release section.
2. Run compile and tests.
3. Package the extension.
4. Install the VSIX locally and smoke test the sidebar.

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

Run the release script:

```sh
npm run release
```

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
