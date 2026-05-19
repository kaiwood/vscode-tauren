#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');

const vendorFiles = [
  {
    packageName: 'markdown-it',
    source: 'markdown-it/dist/markdown-it.min.js',
    target: 'resources/vendor/markdown-it.min.js'
  },
  {
    packageName: 'dompurify',
    source: 'dompurify/dist/purify.min.js',
    target: 'resources/vendor/purify.min.js'
  }
];

for (const vendorFile of vendorFiles) {
  const sourcePath = require.resolve(vendorFile.source, { paths: [root] });
  const targetPath = path.join(root, vendorFile.target);

  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.copyFileSync(sourcePath, targetPath);

  console.log(`Synced ${vendorFile.packageName}: ${path.relative(root, sourcePath)} -> ${vendorFile.target}`);
}
