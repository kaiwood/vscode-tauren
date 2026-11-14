const fs = require('node:fs');
const path = require('node:path');

// Remove generated extension/server/kit output; source descriptors stay untouched.
// Shared output is rebuilt by compile:shared and may be used independently.
for (const directory of ['out', 'sandbox-server/dist', 'resources/generated-sbx-kit', 'resources/generated-sbx-sandbox']) {
  fs.rmSync(path.resolve(__dirname, '..', directory), { recursive: true, force: true });
}
