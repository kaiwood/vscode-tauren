# SBX mixin installation contract

This implements the source/install-contract increment of ADR 0004 (`docs/decisions/0004-adding-sbx-backend`). It does **not** expose an SBX backend or package an SDK server yet.

## Source and installed layout

`resources/sbx-kit/` contains two source descriptors: `mixin.yaml` for the **v2 server mixin** requiring the Pi agent, and `sandbox.yaml` for the **standalone v2 Pi sandbox kit** selecting the runtime image. The sandbox template vendors the contrib configuration from the source revision recorded in its header; it does not use remote inheritance. Staging copies each descriptor as `spec.yaml` into its own temporary kit directory. These remain separate kits, composed at sandbox creation; do not compose them with v3 kits.

During this increment the staging helper creates temporary copies of both descriptors and generates the probe payload in the mixin directory:

```text
files/home/.tauren/server/installation-probe.mjs
```

SBX v2 automatically copies the sibling `files/home/` tree into `/home/agent/`. The fixed installation directory for the future server is **`/home/agent/.tauren/server`**. It must be traversable/readable by `agent` (UID/GID 1000); this directory is not the persisted session store.

Generated directories use `0755` and JavaScript modules `0644`. The probe checks installed ownership and exact modes and is invoked through `node`, just like the future server. No executable wrapper is required; executable-bit preservation must not be assumed for home-file injection. Node must be at least `22.19.0`, matching the current Pi SDK requirement. No root execution, extra network permission, daemon, or port is needed.

There are no install/startup hooks or launch overrides. In v2, static home injection follows install hooks; an install-time `chmod` of a not-yet-injected file is therefore not appropriate. Future packaging must support Node launching readable JavaScript without relying on preserved executable file bits.

## Tests

Local fixture/quoting checks (no VS Code, model credentials, SSH server, or SBX):

```sh
npm run test:sbx-kit
```

The real installation gate is **explicitly invoked**, never part of compile or ordinary tests. Run on a host with Docker Sandboxes supporting v2 kits, OpenSSH, `sbx login`, and `sbx setup ssh` already configured:

```sh
npm run test:sbx-kit:smoke
```

The smoke test reads `piImageReference` from `scripts/sbx-kit-config.json`:

This must be a digest-pinned `docker.io/sbx/pi-image` reference. The configuration file is the source of truth for the selected digest.

Staging interpolates `piImageReference` into the standalone sandbox template's `sandbox.image` as a quoted YAML string. The runner uses that generated Pi sandbox kit as the main kit; no kit argument or parent resolution is needed. Anthropic credential templates are preserved for SBX to expand. Review the copied contrib configuration explicitly when updating it.

The runner checks actual `pi --version` inside the sandbox against the SDK version in `package-lock.json`. Stable releases must have the same major/minor version; patch differences are allowed (for example, sandbox `1.5.0` with SDK `1.5.1`). Prereleases must match exactly. This is a version gate, not proof of behavioral compatibility. Update the image reference alongside SDK updates and run the smoke test to verify compatibility.

The test:

1. Stages the standalone Pi sandbox kit, server mixin, and a disposable workspace outside the checkout.
2. Creates one uniquely named detached sandbox using the rendered sandbox kit and `--kit <staged-mixin>`.
3. Uses **`ssh -T <name>.sbx`**, not `sbx exec`, for every remote check. Local execution uses executable/argv without a shell; remote arguments are separately POSIX-quoted. No environment forwarding, interactive shell initialization, PTY, or host-published port is assumed.
4. Explicitly invokes the installed probe through Node and verifies its successful exit, Node version, and non-root ownership/modes.
5. Removes the test sandbox and temporary fixture tree on success or failure. Cleanup failures fail the test and print the generated name for manual removal. Forced termination of the host runner can leave the test sandbox behind.

The local tests also assert that the mixin descriptor has no startup hooks or service declarations.

## Verification status and sources

Local tests cover staging, version comparison, and remote argument quoting; the real-SBX smoke test verifies runtime composition, SSH execution, and installed ownership/access/modes. Run it after changes to the descriptors, image reference, or staging logic. A passing installation probe does not validate the full SDK server, packaged VSIX, or other platforms; those have separate implementation gates.

Source references (pinned to the inspected v2 revision):

- [V2 schema, composition, static files, and lifecycle](https://github.com/docker/sbx-kits-contrib/blob/1de3c1e3313a4cc8f2ac4d93646ab204f2b3b769/spec/SPEC-v2.md)
- [Pi contrib descriptor](https://github.com/docker/sbx-kits-contrib/blob/1de3c1e3313a4cc8f2ac4d93646ab204f2b3b769/pi/spec.yaml)
- [V2 source file loader (runtime installation modes require verification)](https://github.com/docker/sbx-kits-contrib/blob/1de3c1e3313a4cc8f2ac4d93646ab204f2b3b769/spec/artifact.go)
- [V2 lifecycle authoring notes](https://github.com/docker/sbx-kits-contrib/blob/1de3c1e3313a4cc8f2ac4d93646ab204f2b3b769/skills/kit-author/topics/lifecycle.md)
