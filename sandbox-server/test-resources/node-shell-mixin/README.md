# Node runtime mixin for the SBX shell sandbox

Test-only, declaration-only SBX v3 mixin. It installs Node 22.22.1 under
`/opt/tauren-test-node` from the gzip release archive without changing the shell workload's entrypoint or PATH.
The fixture uses `/opt/tauren-test-node/bin/node` explicitly and verifies its version.

The integration fixture composes this mixin with SBX's built-in v3 `shell` kit:

```sh
npm run test:sandbox-server:sbx
```

No custom base-kit setting is needed. For a standalone sandbox:

```sh
sbx create --name tauren-ssh-test shell /absolute/path/to/workspace \
  --kit /absolute/path/to/sandbox-server/test-resources/node-shell-mixin
```

The descriptor uses v3 `network-policy@1` and `lifecycle@1` capabilities. Network
access to nodejs.org is allowed for installation only. It has no v2 agent-affinity
requirement, and must not be composed with a v2 shell kit. Tauren's production Pi
kits remain separate and unchanged.

Installation runs as root and requires a glibc Linux base with `curl`, `tar`, gzip
decompression, `sha256sum`, and standard shell utilities. Supported architectures
are x86-64 and arm64. It downloads the official architecture-specific archive and
checks the release's published SHA-256 manifest. The version is pinned; checksums
are fetched over TLS rather than vendored or signature-verified.

Schema references:
- https://github.com/docker/sandbox-kit-spec/blob/main/docs/spec/SPEC-v3.md
- https://github.com/docker/sandbox-kit-spec/blob/main/docs/spec/capabilities/com.docker.sandbox/lifecycle@1.md
- https://github.com/docker/sandbox-kit-spec/blob/main/docs/spec/capabilities/com.docker.sandbox/network-policy@1.md

Real-SBX execution remains unverified in environments without the SBX CLI.
