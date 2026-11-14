const { writeFileSync } = require('node:fs');
const { resolve } = require('node:path');

// Node interprets the two compiler outputs independently. No source staging or
// runtime dependency on either consuming project's source tree is necessary.
writeFileSync(resolve(__dirname, '../dist/esm/package.json'), '{"type":"module"}\n');
