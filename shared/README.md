# Tauren shared helpers

Private local Node project consumed by both the extension and `sandbox-server` as
`@tauren/shared` using `file:` dependencies. This is the single maintained source
for transport-independent completion, rendering/facades, session tree/summary,
and origin-scanning logic. VS Code hosts and JSON-RPC lifecycle code remain in
their respective consumers.

```sh
npm ci --prefix shared
npm run compile:shared       # from repository root
npm run test:shared
```

Both consumers' builds build this project first. It emits CommonJS into
`dist/cjs` and ESM into `dist/esm`, plus declarations. Conditional package exports
select the matching format; root `typesVersions` supports the extension's legacy
TypeScript module resolution. All imports from the Pi SDK are type-only: the
package has no runtime dependencies or SDK singleton of its own.

The consumers' `.npmrc` files set `install-links=false` so npm installs local
`file:` dependencies as links rather than stale install-time copies. Install all
three lockfiles for a clean checkout. There is no source synchronization/staging
script. Consumers import helper subpaths directly, for example
`@tauren/shared/completion/piAutocompleteRegistry`.

Package tests verify both consumers' import modes and extract an `npm pack`
artifact into a temporary directory to check operation without repository or SDK
runtime dependencies. The package includes only `dist` and its manifest. VSIX and
sandbox packaging must include the installed local dependency's built files;
shipping a link back to this checkout is not sufficient.

`npm run watch` watches both shared output formats as well as the extension.
Do not run a clean shared build concurrently with running consumers/tests: it
replaces their imported output. Edit shared helpers here; transport-specific
adapters remain in their consumers.
