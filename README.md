# fnox-build

Native, signed builds of [fnox](https://fnox.jdx.dev), the secret manager by [@jdx](https://github.com/jdx): upstream jdx/fnox at a release tag, plus SLICC's patch series from [ai-ecoverse/homescoop](https://github.com/ai-ecoverse/homescoop). They are published to npm as `@ai-ecoverse/fnox`.

```sh
npx @ai-ecoverse/fnox --version
npm install -g @ai-ecoverse/fnox
```

This repository holds no fnox code and no patches. It pins an upstream tag and a homescoop commit, applies the patches, builds the result for six platforms, signs the binaries, tests them, and publishes them. Changes to fnox go to homescoop's patch series. They are not offered upstream.

## The source

- `FNOX_TAG` holds the upstream tag and its commit, `v1.39.0 cc06c75f35bbea98ea594ceba5f3ba94e77a0cdf`. `scripts/fetch.sh` fetches that tag from jdx/fnox and refuses it if it points at another commit.
- `HOMESCOOP_REF` holds one full commit sha of ai-ecoverse/homescoop. `scripts/fetch.sh` fetches only `packages/wasi-fnox/` and `crates/wasix-command/` at that commit (a sparse, blob-filtered fetch), and runs homescoop's `packages/wasi-fnox/apply.sh <fnox source> <homescoop>`:
  - it applies every `packages/wasi-fnox/NNNN-*.patch` in filename order, checking each with `git apply --check` first, and fails if one doesn't apply;
  - it copies homescoop's `crates/wasix-command` into the source, because the patched workspace names it as a path dependency, even natively;
  - it writes `.slicc-patched`, the list of applied patches.
- `scripts/fetch.sh` also checks that homescoop's `packages/wasi-fnox/recipe.yaml` patches the same fnox version as `FNOX_TAG`, and that the patched `Cargo.toml` says that version. A new upstream release moves both pins in one commit.
- homescoop builds `@ai-ecoverse/wasi-fnox`, the WASI build, from the same series. Both builds apply every patch. The patches that matter on a real OS are:
  - **F2:** a `[[proxy.rules]]` `secret` can name a lease credential, and `fnox proxy run` renews it under the same placeholder while the command runs;
  - **F3:** the `command` lease backend runs through `cmd /C` on Windows;
  - the `sealed` provider, which only works inside seven, is not offered by `provider add`.
  The WASI patches compile out on these targets.
- The **source tree** is the git tree hash of the patched source, without fetch.sh's own stamp file (`scripts/source-tree.sh`). Each release records it in its notes as `Source tree: <hash>`.
- `FNOX_TAG` pins the upstream commit rather than the tag tarball's sha256 (`21669929…` for v1.39.0, the tarball homescoop builds from). Both name the same tree.
- `rust-toolchain.toml` pins the Rust toolchain for every target. Each build runs `cargo build --release --locked --bin fnox` with fnox's default features: every native provider (age, plain, the OS keychain, 1Password, Bitwarden, Vault, AWS, Azure and GCP KMS and secret stores, KeePass, and the rest), leases, the proxy, the daemon, MCP and the TUI.

## Platforms

| platform | Rust target | built on | release asset | npm package |
|---|---|---|---|---|
| `darwin-arm64` | `aarch64-apple-darwin` | macOS | `fnox-darwin-arm64` | `@ai-ecoverse/fnox-darwin-arm64` |
| `darwin-x64` | `x86_64-apple-darwin` | macOS | `fnox-darwin-amd64` | `@ai-ecoverse/fnox-darwin-x64` |
| `linux-arm64` | `aarch64-unknown-linux-musl` | Linux, with `cross` | `fnox-linux-arm64` | `@ai-ecoverse/fnox-linux-arm64` |
| `linux-x64` | `x86_64-unknown-linux-musl` | Linux, with `cross` | `fnox-linux-amd64` | `@ai-ecoverse/fnox-linux-x64` |
| `windows-arm64` | `aarch64-pc-windows-msvc` | Windows | `fnox-windows-arm64.exe` | `@ai-ecoverse/fnox-windows-arm64` |
| `windows-x64` | `x86_64-pc-windows-msvc` | Windows | `fnox-windows-amd64.exe` | `@ai-ecoverse/fnox-windows-x64` |

- **Every GitHub release has all six binaries, plus `SHA256SUMS`.** The binaries are plain executables, not archives, and are named `fnox-<goos>-<goarch>[.exe]` with Go's OS and CPU names, as slicc-cli's releases are. `slicc install fnox` downloads them. `SHA256SUMS` lists every binary, and each binary has a build-provenance attestation from this repository's `release.yml`.
- The npm package names use Node's CPU names (`x64`).
- **No host paths in the binaries.** `scripts/build.sh` passes `--remap-path-prefix` for the source directory and for `CARGO_HOME` (each both as given and resolved through symlinks, as on macOS, where `/tmp` is `/private/tmp`), mapping them to `/fnox` and `/cargo`. MSVC builds also pass `/d1trimfile:` for both, in their long and 8.3 short forms, to the C and C++ code of crates such as aws-lc-sys, through the target-specific `CFLAGS_<target>` and `CXXFLAGS_<target>`, so `__FILE__` is relative. OpenSSL's Configure reads only the plain `CFLAGS`, so these flags don't end up in its embedded compiler-flags string. Then `scripts/leak-check.mjs` scans the binary's strings for home directories (`/Users/…`, `/home/…`, `C:\Users\…`), macOS temporary directories (`/private/tmp`, `/private/var`, `/var/folders`) and GitHub runner paths, and the build fails if it finds any.
- **The vendored OpenSSL** (SQLCipher's, and native-tls's on Linux) can't load anything from a directory a user could plant files in:
  - `OPENSSL_CONFIG_DIR=/var/empty` on macOS and Linux, so `OPENSSLDIR` is a root-owned, empty directory, and there is no `openssl.cnf` to read;
  - `CPPFLAGS=-DOPENSSL_NO_AUTOLOAD_CONFIG` on every platform, so OpenSSL never loads a configuration file by itself, and so never loads an engine from one;
  - OpenSSL bakes its install directory under `target/` into `ENGINESDIR` and `MODULESDIR`, which no remap reaches, so CI builds from a directory only root or an administrator can create: `/opt/fnox` on macOS and `C:/Windows/fnox-build` on Windows. On Linux, `cross` builds in a container, where the paths are `/project`, `/target` and `/cargo`. `MODULESDIR` is unused (`no-module`), and Linux builds have no engines (`no-engine`).
  - `scripts/leak-check.mjs` checks this too. Every `OPENSSLDIR`, `ENGINESDIR` and `MODULESDIR` in the binary must be under `/opt/`, `/target/`, `/var/empty` or `C:\Windows\`, and OpenSSL's compiler flags must include `-DOPENSSL_NO_AUTOLOAD_CONFIG`.
  - A local build under a home directory fails the check. Set `FNOX_SRC` to such a directory, or `FNOX_ALLOW_HOST_PATHS=1` to only warn.
- **macOS deployment target:** `MACOSX_DEPLOYMENT_TARGET` is rustc's default for the target (11.0 on arm64, 10.12 on x64), so C code such as OpenSSL is built for the same macOS versions as the Rust code, not for the runner's SDK.
- The Linux binaries are static (musl), so they run on any distribution. As upstream does, they leave out the FIDO2 provider, whose `hidapi` needs a dynamic `libudev`.
- `@ai-ecoverse/fnox` is a Node launcher (Node 18 or newer) with the bin `fnox`. It lists the six platform packages as optional dependencies, so npm installs only the one for the current `os` and `cpu`. It runs that binary with the same arguments and stdio, forwards signals, and exits with the binary's exit code. Installing with `--omit=optional` leaves the launcher without a binary, and it says so.
- The binary reports upstream's version: `fnox --version` prints `fnox 1.39.0`.

## Versions

A release is `<fnox version>-slicc.<n>`, for example `1.39.0-slicc.1`. The git tag is `v1.39.0-slicc.1`.

- `<fnox version>` is `FNOX_TAG` without the `v`.
- `<n>` counts this repository's releases of that fnox version, starting at 1. It goes back to 1 when `FNOX_TAG` moves to a new upstream release.
- The scheme is valid semver, and versions only go up as long as upstream's do. The planner refuses to release a version lower than the last one.
- Every npm package of a release has the same version, and the launcher pins its platform packages to it exactly. Releases go to the npm dist-tag `latest`.
- Because of the `-slicc.<n>` suffix, semver treats every release as a prerelease. `^1.39.0-slicc.1` matches later `1.39.0-slicc.<n>` builds, but not `1.40.0-slicc.1`. Install with `@latest`, or pin the exact version. Renovate users should set `ignoreUnstable: false` for `@ai-ecoverse/fnox`, so that Renovate proposes the next fnox version too.

## Releases

Releases come from `main`, driven by conventional commits as semantic-release reads them.

- `scripts/release-plan.mjs` finds the last `v*-slicc.*` tag, and runs `@semantic-release/commit-analyzer` (Angular preset) over the commits since. A `feat`, `fix`, `perf` or breaking commit makes a release. `chore`, `docs`, `ci`, `test` and the rest don't.
- Renovate bumps `HOMESCOOP_REF` to homescoop's `main` once a day, and the Rust toolchain when Rust releases. Both are `fix(build):` commits, so they release.
- homescoop's `main` moves for many packages besides fnox. A commit that changes only `HOMESCOOP_REF` doesn't count towards a release if the source tree is the same as the last release's. If nothing else releases, the planner skips the release.
- `FNOX_TAG` is not bumped by Renovate: a new upstream tag needs a new patch series in homescoop first.
- The version comes from the scheme above, not from the size of the change.
- `scripts/release.mjs` writes the notes with `@semantic-release/release-notes-generator`, under a line naming the upstream tag and the homescoop commit, and the `Source tree:` line. It creates the GitHub release and the tag at the released commit, and then publishes npm.

`.github/workflows/release.yml` runs on every push to `main`, on pull requests (as a dry run), and by hand (`npm_only`, see below):

1. **plan:** fetches and patches the source, then works out the next version, or nothing to release. A pull request builds as `<fnox version>-dry-run.<run>`.
2. **build:** the six platforms in parallel. Each fetches and patches the source (`scripts/fetch.sh`) and builds it (`scripts/build.sh <platform>`).
3. **test:** the integration tests against each unsigned binary, on its own OS and CPU: macOS arm64 and x64, Linux x64 and arm64, Windows x64 and arm64.
4. **release:** on macOS, `scripts/package.sh <version>` signs, and writes `SHA256SUMS`.
   - The darwin binaries get a Developer ID signature (hardened runtime, secure timestamp, identifier `ai.sliccy.fnox`) and are notarized. That uses the org's Apple secrets.
   - The Windows binaries get an Authenticode signature through Azure Trusted Signing (jsign). That happens only when all the `AZURE_*` secrets are set. Until then they stay unsigned, with a warning.
   - `scripts/npm-stage.mjs` stages the seven npm packages.
   - The job attests build provenance for every file in `SHA256SUMS`, creates the GitHub release with the six binaries (under their release asset names) and `SHA256SUMS`, and publishes npm. Publishing to npm also needs the repository variable `FNOX_NPM_PUBLISH=true`. Without it, the release is GitHub-only and a notice says so.
   - On a pull request, this job packages unsigned and runs `npm publish --dry-run` instead.
5. **smoke:** each signed binary is checked against `SHA256SUMS`, and its `--version` must be `fnox <fnox version>`. On macOS, the darwin binary must also pass `codesign --verify --strict` with the identifier `ai.sliccy.fnox`, a Developer ID Application authority, the hardened runtime and a secure timestamp, so a release whose darwin binaries are unsigned fails here.

npm publishing uses trusted publishing (OIDC, `--provenance`). There is no npm token. Every package is published with `--tag latest`, and the launcher is published last, once all six platform packages are on the registry.

## Verifying a download

```sh
shasum -a 256 -c SHA256SUMS --ignore-missing
gh attestation verify fnox-linux-amd64 --repo ai-ecoverse/fnox-build
codesign --verify --strict --verbose=2 fnox-darwin-arm64
```

## Tests

`test/integration/` drives the built binary with `node --test`. It runs in a scratch `HOME`, with `FNOX_CONFIG_DIR` and `FNOX_STATE_DIR` inside it and the daemon off.

- `fnox --version` prints `fnox <version>`, and in CI it is the version in `FNOX_TAG`.
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

1. In homescoop, carry the patch series over to the new tag in `packages/wasi-fnox/`, and move its `recipe.yaml` version.
2. Here, set `FNOX_TAG` to the new tag and its commit, and `HOMESCOOP_REF` to the homescoop commit with the new series, in one `fix(build):` commit. The release is `<new version>-slicc.1`.
