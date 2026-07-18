import * as assert from 'assert';
import * as fs from 'node:fs';
import * as path from 'node:path';

const peerRuntime = require('../../../scripts/pi-sdk-peer-runtime') as {
  verifyPeerRuntime(outputDir: string): Promise<void>;
};

type PeerRuntimeManifest = {
  piSdkVersion: string;
  peers: Array<{
    packageName: string;
    entries: Array<{ specifier: string; fileName: string }>;
  }>;
};

const extensionRoot = path.resolve(__dirname, '../../..');
const sdkOutputDir = path.join(extensionRoot, 'out', 'sdk');

suite('Pi SDK peer runtime', () => {
  test('ships generated shims that resolve every supported peer import', async () => {
    await peerRuntime.verifyPeerRuntime(sdkOutputDir);

    const manifest = JSON.parse(
      fs.readFileSync(path.join(sdkOutputDir, 'peer-runtime-manifest.json'), 'utf-8')
    ) as PeerRuntimeManifest;

    assert.match(manifest.piSdkVersion, /^\d+\.\d+\.\d+/);
    assert.deepStrictEqual(
      manifest.peers.map((peer) => peer.packageName),
      [
        'typebox',
        '@earendil-works/pi-agent-core',
        '@earendil-works/pi-ai',
        '@earendil-works/pi-tui'
      ]
    );

    for (const peer of manifest.peers) {
      assert.ok(peer.entries.length > 0, `${peer.packageName} should expose at least one module.`);
      for (const entry of peer.entries) {
        assert.ok(
          fs.existsSync(path.join(sdkOutputDir, 'node_modules', ...peer.packageName.split('/'), entry.fileName)),
          `${entry.specifier} should have a generated shim.`
        );
      }
    }
  });
});
