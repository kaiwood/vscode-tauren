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

Run tests with:

```sh
npm test
```

For documentation changes:

```sh
npm run docs:dev
npm run docs:build
```
