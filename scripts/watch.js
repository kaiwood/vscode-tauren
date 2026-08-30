#!/usr/bin/env node

const { spawn } = require('child_process');
const esbuild = require('esbuild');

const children = new Set();
let esbuildContext;
let shuttingDown = false;

function spawnNodeScript(label, scriptPath, args) {
  const child = spawn(process.execPath, [scriptPath, ...args], {
    stdio: 'inherit'
  });

  children.add(child);

  child.on('exit', (code, signal) => {
    children.delete(child);

    if (shuttingDown) {
      return;
    }

    const status = signal ? `signal ${signal}` : `code ${code ?? 0}`;
    console.error(`[watch] ${label} exited with ${status}; stopping watch tasks.`);
    void shutdown(code === 0 || code === null ? 1 : code);
  });

  child.on('error', (error) => {
    if (shuttingDown) {
      return;
    }

    console.error(`[watch] Failed to start ${label}: ${error.message}`);
    void shutdown(1);
  });
}

async function shutdown(exitCode) {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;

  for (const child of children) {
    child.kill();
  }

  if (esbuildContext) {
    await esbuildContext.dispose();
  }

  process.exit(exitCode);
}

process.on('SIGINT', () => { void shutdown(130); });
process.on('SIGTERM', () => { void shutdown(143); });

async function main() {
  esbuildContext = await esbuild.context({
    entryPoints: ['src/webview/main.ts'],
    bundle: true,
    format: 'iife',
    target: 'es2022',
    outfile: 'resources/webview/chat.js',
    sourcemap: process.env.TAUREN_WEBVIEW_SOURCEMAP === '1' ? 'inline' : false,
    logLevel: 'info'
  });
  await esbuildContext.watch();

  spawnNodeScript(
    'TypeScript compiler',
    require.resolve('typescript/bin/tsc'),
    ['-watch', '-p', './']
  );
}

main().catch((error) => {
  console.error(`[watch] Failed to start webview esbuild watch: ${error instanceof Error ? error.message : String(error)}`);
  void shutdown(1);
});
