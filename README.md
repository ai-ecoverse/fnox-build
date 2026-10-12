# fnox-build

Native, signed builds of [fnox](https://fnox.jdx.dev), the secret manager by [@jdx](https://github.com/jdx), built from SLICC's fork [ai-ecoverse/fnox](https://github.com/ai-ecoverse/fnox). They are published to npm as `@ai-ecoverse/fnox`.

```sh
npx @ai-ecoverse/fnox --version
npm install -g @ai-ecoverse/fnox
```

This repository holds no fnox code. It pins one commit of the fork, builds that commit for six platforms, signs the binaries, tests them, and publishes them. Changes to fnox itself go to the fork.

## The source

- `FNOX_REF` holds one full commit sha of `ai-ecoverse/fnox`, the head of its `slicc/v<major.minor>` branch. Renovate tracks the branch (`slicc/v1.39`) and proposes a new sha when the branch moves.
- The branch is upstream fnox at a release tag, plus SLICC's patch commits. The fork's `SLICC.md` lists them. The ones that matter on a real OS are:
  - **F2:** a `[[proxy.rules]]` `secret` can name a lease credential, and `fnox proxy run` renews it under the same placeholder while the command runs;
  - **F3:** the `command` lease backend runs through `cmd /C` on Windows;
  - the `sealed` provider, which only works inside seven, is not offered by `provider add`.
- The fork's WASI patches compile out on these targets and change nothing here. homescoop builds the WASI build (`@ai-ecoverse/wasi-fnox`) from the same branch.
- `rust-toolchain.toml` pins the Rust toolchain for every target. Each build runs `cargo build --release --locked --bin fnox` with fnox's default features: every native provider (age, plain, the OS keychain, 1Password, Bitwarden, Vault, AWS, Azure and GCP KMS and secret stores, KeePass, and the rest), leases, the proxy, the daemon, MCP and the TUI.

## Platforms

| platform | Rust target | built on | npm package |
|---|---|---|---|
| `darwin-arm64` | `aarch64-apple-darwin` | macOS | `@ai-ecoverse/fnox-darwin-arm64` |
| `darwin-x64` | `x86_64-apple-darwin` | macOS | `@ai-ecoverse/fnox-darwin-x64` |
| `linux-arm64` | `aarch64-unknown-linux-musl` | Linux, with `cross` | `@ai-ecoverse/fnox-linux-arm64` |
| `linux-x64` | `x86_64-unknown-linux-musl` | Linux, with `cross` | `@ai-ecoverse/fnox-linux-x64` |
| `windows-arm64` | `aarch64-pc-windows-msvc` | Windows | `@ai-ecoverse/fnox-windows-arm64` |
| `windows-x64` | `x86_64-pc-windows-msvc` | Windows | `@ai-ecoverse/fnox-windows-x64` |

- The Linux binaries are static (musl), so they run on any distribution. As upstream does, they leave out the FIDO2 provider, whose `hidapi` needs a dynamic `libudev`.
- `@ai-ecoverse/fnox` is a Node launcher (Node 18 or newer) with the bin `fnox`. It lists the six platform packages as optional dependencies, so npm installs only the one for the current `os` and `cpu`. It runs that binary with the same arguments and stdio, forwards signals, and exits with the binary's exit code. Installing with `--omit=optional` leaves the launcher without a binary, and it says so.
- The binary reports upstream's version: `fnox --version` prints `fnox 1.39.0`.

## Versions

A release is `<fnox version>-slicc.<n>`, for example `1.39.0-slicc.1`. The git tag is `v1.39.0-slicc.1`.

- `<fnox version>` is the `[workspace.package]` version in the fork's `Cargo.toml` at `FNOX_REF`.
- `<n>` counts this repository's releases of that fnox version, starting at 1. It goes back to 1 when the fork moves to a new upstream release.
- The scheme is valid semver, and versions only go up as long as upstream's do. The planner refuses to release a version lower than the last one.
- Every npm package of a release has the same version, and the launcher pins its platform packages to it exactly. Releases go to the npm dist-tag `latest`.
- Because of the `-slicc.<n>` suffix, semver treats every release as a prerelease. `^1.39.0-slicc.1` matches later `1.39.0-slicc.<n>` builds, but not `1.40.0-slicc.1`. Install with `@latest`, or pin the exact version. Renovate users should set `ignoreUnstable: false` for `@ai-ecoverse/fnox`, so that Renovate proposes the next fnox version too.

## Releases

Releases come from `main`, driven by conventional commits as semantic-release reads them.

- `scripts/release-plan.mjs` finds the last `v*-slicc.*` tag, and runs `@semantic-release/commit-analyzer` (Angular preset) over the commits since. A `feat`, `fix`, `perf` or breaking commit makes a release. `chore`, `docs`, `ci`, `test` and the rest don't.
- Renovate's bumps of `FNOX_REF` and of the Rust toolchain are `fix(build):` commits, so they release.
- The version comes from the scheme above, not from the size of the change.
- `scripts/release.mjs` writes the notes with `@semantic-release/release-notes-generator`, under a line naming the fnox version and fork commit. It creates the GitHub release and the tag at the released commit, and then publishes npm.

`.github/workflows/release.yml` runs on every push to `main`, on pull requests (as a dry run), and by hand (`npm_only`, see below):

1. **plan:** the next version, or nothing to release. A pull request builds as `<fnox version>-dry-run.<run>`.
2. **build:** the six platforms in parallel. Each fetches the fork at `FNOX_REF` (`scripts/fetch.sh`) and builds it (`scripts/build.sh <platform>`).
3. **test:** the integration tests against each unsigned binary, on its own OS and CPU: macOS arm64 and x64, Linux x64 and arm64, Windows x64 and arm64.
4. **release:** on macOS, `scripts/package.sh <version>` signs, and writes `SHA256SUMS`.
   - The darwin binaries get a Developer ID signature (hardened runtime, secure timestamp, identifier `ai.sliccy.fnox`) and are notarized. That uses the org's Apple secrets.
   - The Windows binaries get an Authenticode signature through Azure Trusted Signing (jsign). That happens only when all the `AZURE_*` secrets are set. Until then they stay unsigned, with a warning.
   - `scripts/npm-stage.mjs` stages the seven npm packages.
   - The job attests build provenance for every file in `SHA256SUMS`, creates the GitHub release with the six binaries and `SHA256SUMS`, and publishes npm. Publishing to npm also needs the repository variable `FNOX_NPM_PUBLISH=true`. Without it, the release is GitHub-only and a notice says so.
   - On a pull request, this job packages unsigned and runs `npm publish --dry-run` instead.
5. **smoke:** each signed binary is checked against `SHA256SUMS`, and its `--version` must be `fnox <fnox version>`.

npm publishing uses trusted publishing (OIDC, `--provenance`). There is no npm token. The launcher is published last, once all six platform packages are on the registry.

## Verifying a download

```sh
shasum -a 256 -c SHA256SUMS --ignore-missing
gh attestation verify fnox-linux-x64 --repo ai-ecoverse/fnox-build
codesign --verify --strict --verbose=2 fnox-darwin-arm64
```

## Tests

`test/integration/` drives the built binary with `node --test`. It runs in a scratch `HOME`, with `FNOX_CONFIG_DIR` and `FNOX_STATE_DIR` inside it and the daemon off.

- `fnox --version` prints `fnox <version>`, and in CI it is the fnox version at `FNOX_REF`.
- **plain:** `fnox set` from stdin, then `fnox get`, returns the value.
- **age:** with a fresh X25519 identity, `fnox set` keeps only ciphertext in `fnox.toml`. `fnox get` decrypts it with `FNOX_AGE_KEY`, and fails with another identity.
- **lease plus proxy (F2 and F3):**
  - A `command` lease prints a new token on every run, valid for 6 seconds.
  - A proxy rule names that token (`GH_TOKEN`) for `localhost`.
  - `fnox proxy run -- node client.mjs` makes requests through the proxy to a local HTTPS upstream on port 443.
  - The checks:
    - the child only ever sees one generated placeholder;
    - the upstream gets the first token, then a renewed one, under the same placeholder;
    - tokens reflected in responses come back as the placeholder;
    - a request outside the rule's paths gets 403 and never reaches the upstream;
    - the lease is recorded in the ledger.
  - On Windows the lease command runs through `cmd /C` with quoted paths, which is F3.

The proxy test needs an upstream that fnox trusts on port 443. `scripts/test-tls.sh` makes a throwaway CA and a `localhost` certificate. It trusts the CA system-wide (the System keychain on macOS, `update-ca-certificates` on Linux, the machine Root store on Windows), and on Linux it allows unprivileged binds from port 443 up. It needs root, so CI runs it, and it is not meant for a workstation. Without `FNOX_TEST_TLS_DIR`, the proxy test is skipped, but in CI (`CI` set) a missing `FNOX_TEST_TLS_DIR` is a failure. `scripts/test-tls.sh --no-trust <dir>` only writes the files.

```sh
npm ci
npm run build
npm test
```

`npm run build` builds the host platform into `artifacts/build/`. The tests use that binary, or `FNOX_BIN`.

## Commands

| command | does |
|---|---|
| `npm run lint` | `slicc-lint` (Biome, no comments, no committed unit tests, AGENTS.md) and `shellcheck` |
| `npm test` | the integration tests |
| `npm run build` | `scripts/build.sh` for the host platform. `scripts/build.sh <platform>` builds another; Linux musl targets use `cross` on Linux |
| `npm run dist` | `scripts/package.sh` unsigned, from `artifacts/build/` into `artifacts/release/` |
| `npm run npm:stage` / `npm run npm:check` | stage the npm packages into `dist/npm/`, and dry-run their publish |
| `npm run plan` | print the next version, or none |
| `npm run claim` | claim the npm names and set up trusted publishing (`fledgling sync --new`) |
| `npm run trust` / `npm run trust:dry` | reconcile trusted publishing for the existing names |

## Setting up (operators)

These steps need org or npm rights, and are done once:

1. **The Apple secrets:** add `ai-ecoverse/fnox-build` to the repositories that may read the org secrets `APPLE_CERTIFICATE_BASE64`, `APPLE_DEVELOPER_CERTIFICATE_PASSWORD`, `APPLE_API_KEY_ID`, `APPLE_API_KEY_ISSUER_ID` and `APPLE_API_KEY_P8_BASE64`. Until then the darwin binaries ship unsigned, with a warning.
2. **The npm names:** in a checkout of this repository, run `npm ci`, then `FLEDGLING_OTP_SECRET=… npm run claim`. That publishes `0.0.0` placeholders for the seven names in `package.json`'s `fledgling.include`, and makes `ai-ecoverse/fnox-build` `release.yml` their trusted publisher. `npm run trust:dry` shows the plan first.
3. **Turn on npm publishing:** `gh variable set FNOX_NPM_PUBLISH --repo ai-ecoverse/fnox-build --body true`. The next release publishes. To publish a release that went out GitHub-only, run the workflow by hand with its tag: `gh workflow run release.yml --repo ai-ecoverse/fnox-build -f npm_only=v1.39.0-slicc.1`. That job downloads the release's binaries, checks them against its `SHA256SUMS`, stages the packages, and publishes them. Versions already on npm are skipped.
4. **Windows signing, later:** set the repository secrets `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `AZURE_TRUSTED_SIGNING_ENDPOINT`, `AZURE_TRUSTED_SIGNING_ACCOUNT`, `AZURE_TRUSTED_SIGNING_PROFILE`, and `AZURE_CLIENT_SECRET` or a federated credential for this repository's workflow.
5. **Renovate:** enable the org's Renovate app for this repository.

## A new upstream release

1. In the fork, branch `slicc/v<major.minor>` from the upstream tag, and carry the patch series over, as the fork's `SLICC.md` says.
2. Here, change `currentValueTemplate` in `renovate.json` to the new branch, and set `FNOX_REF` to its head, in one `fix(build):` commit. The release is `<new version>-slicc.1`.
