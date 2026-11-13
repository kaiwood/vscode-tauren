import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

// Real-SBX tests are opt-in: ordinary tests must not create VMs or require SBX
// login/SSH setup. Pass explicit files portably instead of shell glob exclusions.
const tests = ['dist/test', 'dist/completion'].flatMap(directory =>
  readdirSync(directory).filter(name => name.endsWith('.test.js') && !name.endsWith('.sbx.test.js'))
    .map(name => `${directory}/${name}`));
const result = spawnSync(process.execPath, ['--test', ...tests], { stdio: 'inherit' });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
