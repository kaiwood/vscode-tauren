#!/usr/bin/env node

const path = require('path');
const { verifyPeerRuntime } = require('./pi-sdk-peer-runtime');

const root = path.resolve(__dirname, '..');
const outputDir = path.join(root, 'out', 'sdk');

verifyPeerRuntime(outputDir).catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
