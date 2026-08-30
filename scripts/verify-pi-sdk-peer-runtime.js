#!/usr/bin/env node

const path = require('path');
const { verifyPeerRuntime } = require('./pi-sdk-peer-runtime');

const root = path.resolve(__dirname, '..');
const peerRuntimeDir = path.join(root, 'resources', 'pi-sdk-runtime', 'sdk');
const bundleFile = path.join(peerRuntimeDir, 'piSdkBundle.mjs');

verifyPeerRuntime(peerRuntimeDir, bundleFile).catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
