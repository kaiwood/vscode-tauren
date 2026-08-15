#!/usr/bin/env node

// Builds the webview bundle (src/webview/main.ts -> resources/webview/chat.js).
// Set TAUREN_WEBVIEW_SOURCEMAP=1 to embed an inline source map for debugging
// webview code in DevTools / the webview debugger.

const esbuild = require('esbuild');

esbuild.build({
  entryPoints: ['src/webview/main.ts'],
  bundle: true,
  format: 'iife',
  target: 'es2022',
  outfile: 'resources/webview/chat.js',
  sourcemap: process.env.TAUREN_WEBVIEW_SOURCEMAP === '1' ? 'inline' : false
}).catch(() => {
  process.exit(1);
});
