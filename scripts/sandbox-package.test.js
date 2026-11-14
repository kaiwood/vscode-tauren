/**
 * Verify the Tauren server as shipped in a VSIX (VS Code's installable extension
 * archive), not just the compiled development server in sandbox-server/dist.
 * Extract the archive outside the checkout and run its server with a separately
 * provisioned Pi installation, catching missing files, broken bundled imports,
 * runtime-resolution errors and accidental dependencies on the development tree.
 * The server loads and controls Pi through its SDK in the same Node process;
 * it does not run inside a separate Pi CLI process.
 *
 * An ordinary offline provider extension supplies deterministic model responses
 * while real SDK tools, UI, persistence and export are exercised. The fixture
 * replaces model I/O, not Pi. These local artifact tests require neither SBX nor
 * model credentials and do not establish sandbox/SSH end-to-end correctness.
 */
const assert = require('node:assert/strict');
const { spawn, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const { createRequire } = require('node:module');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');

const root = path.resolve(__dirname, '..');
const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8'));

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { cwd: root, encoding: 'utf8', timeout: 300_000,
    maxBuffer: 32 * 1024 * 1024, ...options });
  assert.ifError(result.error);
  assert.equal(result.status, 0, `${command} ${args.join(' ')}\n${result.stdout}\n${result.stderr}`);
  return result.stdout;
}

async function bounded(promise, label) {
  let timer;
  try {
    return await Promise.race([promise, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`Timed out: ${label}`)), 20_000);
    })]);
  } finally { clearTimeout(timer); }
}

function filesBelow(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const file = path.join(directory, entry.name);
    assert(!entry.isSymbolicLink(), `Unexpected packaged symlink: ${file}`);
    return entry.isDirectory() ? filesBelow(file) : [file];
  });
}

// This is a separately provisioned existing harness, NOT part of the server
// payload. Materialize its installed production tree so neither CLI discovery
// nor SDK imports can follow a checkout symlink or borrow checkout dependencies.
function stageHarness(directory) {
  const project = path.join(root, 'sandbox-server');
  const harness = path.join(directory, 'harness');
  const lock = readJson(path.join(project, 'package-lock.json'));
  for (const [name, metadata] of Object.entries(lock.packages)) {
    if (!/^node_modules\/(?:@[^/]+\/)?[^/]+$/.test(name) || metadata.dev) continue;
    const source = path.join(project, name);
    if (!fs.existsSync(source)) {
      assert(metadata.optional, `Missing installed runtime dependency: ${name}`);
      continue;
    }
    const resolved = fs.realpathSync(source);
    const destination = path.join(harness, name);
    if (readJson(path.join(resolved, 'package.json')).name === '@tauren/shared') {
      fs.mkdirSync(destination, { recursive: true });
      fs.copyFileSync(path.join(resolved, 'package.json'), path.join(destination, 'package.json'));
      fs.cpSync(path.join(resolved, 'dist'), path.join(destination, 'dist'), { recursive: true, dereference: true });
    } else {
      fs.cpSync(resolved, destination, { recursive: true, dereference: true });
    }
  }
  filesBelow(harness); // All package links must have been materialized.
  const sdk = path.join(harness, 'node_modules/@earendil-works/pi-coding-agent');
  const bin = path.join(harness, 'node_modules/.bin');
  fs.mkdirSync(bin, { recursive: true });
  fs.symlinkSync(path.relative(bin, path.join(sdk, readJson(path.join(sdk, 'package.json')).bin.pi)), path.join(bin, 'pi'));
  return { bin, sdk };
}

function childEnvironment(directory, agent, searchPath) {
  // Never inherit PATH, NODE_PATH/NODE_OPTIONS, credentials, or developer Pi
  // config. Even the CLI symlink resolves entirely within the external fixture.
  return { PATH: searchPath, HOME: directory, USERPROFILE: directory,
    TMPDIR: directory, NO_COLOR: '1', PI_CODING_AGENT_DIR: agent };
}

function assertHarnessFailure(main, directory, agent, searchPath) {
  const result = spawnSync(process.execPath, [main], {
    cwd: directory, encoding: 'utf8', timeout: 20_000,
    env: childEnvironment(directory, agent, searchPath)
  });
  assert.ifError(result.error);
  assert.equal(result.signal, null, result.stderr);
  assert.notEqual(result.status, 0, 'Missing/invalid harness must fail explicitly');
  assert.equal(result.stdout, '', 'An unusable harness must not produce a protocol handshake');
  assert.match(result.stderr, /pi|sdk/i, 'Failure must diagnose the unusable Pi harness');
}

function launch(main, directory, agent, rpc, searchPath) {
  const child = spawn(process.execPath, [main], {
    cwd: directory, stdio: ['pipe', 'pipe', 'pipe'],
    env: childEnvironment(directory, agent, searchPath)
  });
  let stderr = '';
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', chunk => { stderr += chunk; });
  const exited = new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code, signal) => resolve({ code, signal }));
  });
  void exited.catch(() => {});
  const errors = [];
  const client = rpc.createMessageConnection(new rpc.StreamMessageReader(child.stdout),
    new rpc.StreamMessageWriter(child.stdin), { error: message => errors.push(message), warn() {}, info() {}, log() {} });
  client.onError(error => errors.push(error));
  const events = [];
  const notifications = [];
  const listeners = new Set();
  client.onNotification((method, params) => {
    notifications.push({ method, params });
    if (method === 'agent.event') events.push(params);
    for (const listener of listeners) listener();
  });
  const dialogs = [];
  client.onRequest('ui.select', params => { dialogs.push(params); return 'archive-answer'; });
  for (const method of ['ui.confirm', 'ui.input', 'ui.editor', 'ui.custom']) client.onRequest(method, () => null);
  client.listen();
  const server = {
    events, notifications, dialogs,
    async request(method, params = null) {
      try { return await bounded(client.sendRequest(method, params), method); }
      catch (error) { throw new Error(`${method}: ${error.stack || error}\nstderr: ${stderr}`); }
    },
    async waitFor(predicate, label) {
      let check;
      try {
        return await bounded(new Promise(resolve => {
          check = () => { if (predicate()) resolve(); };
          listeners.add(check); check();
        }), label);
      } catch (error) { throw new Error(`${error}\nstderr: ${stderr}`); }
      finally { listeners.delete(check); }
    },
    async turn(message) {
      const start = events.length;
      assert.equal(await server.request('chat.prompt', { message }), null);
      await server.waitFor(() => events.slice(start).some(item => item.event.type === 'agent_settled'), 'agent_settled');
      return (await server.request('session.getMessages')).messages;
    },
    async shutdown() {
      assert.equal(await server.request('shutdown'), null);
      child.stdin.end();
      assert.deepEqual(await bounded(exited, 'server exit'), { code: 0, signal: null }, stderr);
      assert.deepEqual(errors, [], `Only framed JSON-RPC may reach stdout: ${stderr}`);
      assert.match(stderr, /packaged offline provider loaded/);
      client.dispose();
    },
    async close() {
      client.dispose();
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
      await bounded(exited, 'server cleanup');
    }
  };
  return server;
}

test('actual VSIX server uses an independently provisioned Pi harness outside the checkout', { timeout: 600_000 }, async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'tauren-packaged-'));
  const children = [];
  try {
    assert(!directory.startsWith(`${root}${path.sep}`), 'Test must execute outside the checkout');
    const archive = process.env.TAUREN_TEST_VSIX
      ? path.resolve(process.env.TAUREN_TEST_VSIX) : path.join(directory, 'tauren.vsix');
    if (!process.env.TAUREN_TEST_VSIX) {
      // Full production dependency collection and the normal prepublish hook.
      // vsce has no supported --no-prepublish flag. The orchestrator can supply
      // its already-built VSIX to avoid building twice. No version arg mutates Git.
      run('npx', ['--yes', '@vscode/vsce', 'package', '--out', archive]);
    }
    assert(fs.statSync(archive).isFile(), `Missing VSIX: ${archive}`);
    const members = run('unzip', ['-Z1', archive]).trim().split(/\r?\n/);
    assert(members.length > 0);
    const seen = new Set();
    for (const member of members) {
      assert(member && !member.includes('\\') && !member.includes('\0') && !path.posix.isAbsolute(member)
        && !/^[A-Za-z]:/.test(member) && !member.split('/').some(part => part === '..' || part === '.'),
      `Unsafe archive member: ${member}`);
      assert(!seen.has(member), `Duplicate archive member: ${member}`);
      seen.add(member);
      assert(!/^extension\/(?:src|shared|sandbox-server|scripts|test|tests)\//.test(member),
        `Source/test tree leaked into VSIX: ${member}`);
    }
    const listing = run('unzip', ['-Z', '-l', archive]);
    assert(!/^l[rwxstST-]{9}\s/m.test(listing), 'Archive must not contain symlinks');
    const extracted = path.join(directory, 'extracted');
    fs.mkdirSync(extracted);
    run('unzip', ['-q', archive, '-d', extracted]);
    const extension = path.join(extracted, 'extension');
    filesBelow(extracted); // Reject symlinks before following any runtime paths.
    const kit = path.join(extension, 'resources/generated-sbx-kit');
    const server = path.join(kit, 'files/home/.tauren/server');
    const main = path.join(server, 'dist/main.js');
    for (const file of [main, path.join(server, 'package.json'), path.join(kit, 'spec.yaml'),
      path.join(extension, 'resources/generated-sbx-sandbox/spec.yaml'), path.join(server, 'dist/sandboxPi.js')]) {
      assert(fs.statSync(file).isFile(), `Missing packaged asset: ${file}`);
    }
    const payloadFiles = filesBelow(server).map(file => path.relative(server, file).split(path.sep).join('/'));
    assert(!payloadFiles.some(file => /^(?:src|test|tests)\/|^dist\/(?:test|tests)\//.test(file)), 'Standalone server must not ship tests/source');
    assert(!payloadFiles.some(file => /(?:^|\/)node_modules\/(?:typescript|esbuild)\//.test(file)), 'Build dependencies must not ship in server');
    for (const file of payloadFiles.filter(file => /\.(?:mjs|cjs|js)$/.test(file))) {
      assert(!fs.readFileSync(path.join(server, file), 'utf8').includes(root),
        `Packaged runtime must not embed checkout paths: ${file}`);
    }
    assert(!fs.existsSync(path.join(server, 'pi-sdk-runtime')), 'Server must not ship a second Pi runtime');
    assert(!payloadFiles.some(file => /(?:^|\/)node_modules\/|(?:^|\/)sdk\/|^dist\/index\.js$|piSdkBundle|export-html/.test(file)),
      'Server must contain only its own bundles, not an SDK, peer shims, or SDK assets');
    const rootPi = readJson(path.join(root, 'package-lock.json')).packages['node_modules/@earendil-works/pi-coding-agent'].version;
    const expectedPi = readJson(path.join(root, 'sandbox-server/package-lock.json')).packages['node_modules/@earendil-works/pi-coding-agent'].version;
    assert(require('./verify-sandbox-sdk-version').sdkVersionsCompatible(rootPi, expectedPi));
    assert.equal(readJson(path.join(server, 'package.json')).sandboxPiSdkVersion, expectedPi);
    assert.equal(readJson(path.join(extension, 'resources/pi-sdk-runtime/package.json')).version, rootPi);
    assert.equal(readJson(path.join(extension, 'package.json')).version, readJson(path.join(root, 'package.json')).version);
    const image = readJson(path.join(root, 'scripts/sbx-kit-config.json')).piImageReference;
    const descriptor = fs.readFileSync(path.join(extension, 'resources/generated-sbx-sandbox/spec.yaml'), 'utf8');
    assert(descriptor.includes(image), 'Packaged descriptor must contain configured pinned image');
    assert(!descriptor.includes('{{piImageReference}}'), 'Descriptor image must be rendered');
    const manifest = readJson(path.join(kit, 'build-manifest.json'));
    assert.equal(manifest.formatVersion, 1);
    assert.equal(manifest.piSdkVersion, expectedPi);
    assert.equal(manifest.runtimeSource, 'sandbox-pi');
    assert.equal(manifest.piImageReference, image);
    assert.equal(manifest.extensionVersion, readJson(path.join(extension, 'package.json')).version);
    assert.equal(manifest.serverVersion, readJson(path.join(server, 'package.json')).version);
    assert.equal(manifest.entrypoint, 'files/home/.tauren/server/dist/main.js');
    const harness = stageHarness(directory);
    const loadedPi = readJson(path.join(harness.sdk, 'package.json')).version;
    assert(require('./verify-sandbox-sdk-version').sdkVersionsCompatible(manifest.piSdkVersion, loadedPi));

    // The host framing library may come from the checkout; the child may not.
    // No application/protocol modules are imported from checkout or dist/test.
    const rpc = createRequire(path.join(root, 'sandbox-server/package.json'))('vscode-jsonrpc/node');
    const workspace = path.join(directory, 'workspace');
    const agent = path.join(directory, 'agent');
    const sessionDirectory = path.join(directory, 'sessions');
    for (const dir of [workspace, agent, sessionDirectory]) fs.mkdirSync(dir);
    const fixture = path.join(agent, 'packaged-offline-provider.mjs');
    fs.copyFileSync(path.join(__dirname, 'fixtures/packaged-offline-provider.mjs'), fixture);
    fs.writeFileSync(path.join(agent, 'settings.json'), JSON.stringify({
      defaultProvider: 'packaged-offline', defaultModel: 'scripted', extensions: [fixture],
      compaction: { enabled: false }, retry: { enabled: false }
    }));
    const params = { protocolVersion: 1, clientVersion: 'packaged-offline-test', workspace, sessionDirectory };
    const missingBin = path.join(directory, 'missing-bin');
    const invalidBin = path.join(directory, 'invalid-bin');
    for (const bin of [missingBin, invalidBin]) fs.mkdirSync(bin);
    fs.writeFileSync(path.join(invalidBin, 'pi'), '#!/usr/bin/env node\n// Not a Pi SDK installation.\n', { mode: 0o755 });
    assertHarnessFailure(main, directory, agent, missingBin);
    assertHarnessFailure(main, directory, agent, invalidBin);
    // Reject drift in the harness we actually resolve, not a second bundled SDK.
    const harnessManifestPath = path.join(harness.sdk, 'package.json');
    const harnessManifest = fs.readFileSync(harnessManifestPath, 'utf8');
    fs.writeFileSync(harnessManifestPath, JSON.stringify({ ...JSON.parse(harnessManifest), version: '999.0.0' }));
    try { assertHarnessFailure(main, directory, agent, harness.bin); }
    finally { fs.writeFileSync(harnessManifestPath, harnessManifest); }
    const first = launch(main, directory, agent, rpc, harness.bin); children.push(first);
    const initialized = await first.request('initialize', params);
    assert.equal(initialized.piVersion, loadedPi);
    assert.equal(initialized.workspace, workspace);
    assert.equal(initialized.sessionDirectory, sessionDirectory);
    for (const method of ['chat.prompt', 'session.getMessages', 'session.exportHtml', 'ui.render']) {
      assert(initialized.capabilities.includes(method), `Missing capability: ${method}`);
    }
    await first.turn('source-check');
    assert.match((await first.request('session.getLastAssistantText')).text, /source=rpc/);
    assert((await first.request('session.getLastAssistantText')).text.includes(directory));
    const messages = await first.turn('tools-roundtrip');
    assert.equal(fs.readFileSync(path.join(workspace, 'packaged-roundtrip.txt'), 'utf8'), 'after\n');
    const results = messages.filter(message => message.role === 'toolResult');
    assert.deepEqual(results.map(message => message.toolName), ['write', 'read', 'edit', 'read', 'packaged_echo']);
    assert(results.every(message => !message.isError), JSON.stringify(results));
    assert(first.events.some(item => item.event.type === 'tool_execution_end'));
    await first.request('chat.prompt', { message: '/packaged-ui' });
    await first.waitFor(() => first.notifications.some(item => item.method === 'ui.notify'
      && item.params.message === 'packaged-ui:archive-answer'), 'extension UI notification');
    assert.equal(first.dialogs[0].title, 'packaged-select');
    const widget = first.notifications.find(item => item.method === 'ui.widget' && item.params.key === 'packaged-widget');
    assert(widget?.params.content?.surfaceId, 'Function widget must become a remote surface');
    const rendered = await first.request('ui.render', { surfaceId: widget.params.content.surfaceId, width: 80, height: 12 });
    assert(rendered.lines.join('\n').includes('packaged-widget:archive-answer'));
    const state = await first.request('runtime.getState');
    assert.equal(typeof state.sessionFile, 'string');
    assert(path.relative(sessionDirectory, state.sessionFile) && !path.relative(sessionDirectory, state.sessionFile).startsWith('..'));
    const history = await first.request('session.getMessages');
    await first.shutdown();
    assert(fs.statSync(state.sessionFile).size > 0, 'SDK must persist the session');
    const second = launch(main, directory, agent, rpc, harness.bin); children.push(second);
    await second.request('initialize', { ...params, sessionFile: state.sessionFile });
    assert.deepEqual(await second.request('session.getMessages'), history, 'Reopen must restore SDK persisted history');
    const outputPath = path.join(directory, 'session.html');
    const exported = await second.request('session.exportHtml', { outputPath });
    assert.equal(exported.path, outputPath);
    assert.equal(exported.html, fs.readFileSync(outputPath, 'utf8'));
    assert.match(exported.html, /<!doctype html/i);
    // Pi embeds session data as base64 JSON, not visible plaintext in the HTML.
    const encoded = /<script id="session-data" type="application\/json">([^<]+)<\/script>/.exec(exported.html);
    assert(encoded, 'Export must embed persisted session data');
    assert(Buffer.from(encoded[1], 'base64').toString('utf8').includes('tools-roundtrip'));
    assert(!exported.html.includes(root), 'Export must not reference the checkout');
    await second.shutdown();
  } finally {
    try { await Promise.all(children.map(child => child.close())); }
    finally { fs.rmSync(directory, { recursive: true, force: true }); }
  }
});
