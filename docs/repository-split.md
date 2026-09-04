# Repository split: private development / public releases

## Target layout

### Private development repository

`gugu9999gu/How-much-is-tokens`

Contains:

- application source
- tests and development workflows
- provider integration logic
- Leerness state under `.leerness/`
- internal development documentation

This repository should be changed from **Public** to **Private**.

### Public release repository

`gugu9999gu/How-much-is-tokens-releases`

Contains only:

- public release repository `README.md`
- Windows portable EXE release assets
- `SHA256SUMS.txt`
- release notes / release metadata
- public user issues if enabled

Do not mirror the development Git history or source tree into the public release repository.

## GitHub administration required once

The connected development automation does not have repository-administration or Actions-secret administration permission. Complete these GitHub UI operations once:

1. Open `gugu9999gu/How-much-is-tokens` → **Settings** → **General** → **Danger Zone** → **Change repository visibility** → change it to **Private**.
2. Create a new **Public** repository named `gugu9999gu/How-much-is-tokens-releases`. It may be empty; the publish workflow can create the public release README on first publish.
3. Create a fine-grained GitHub token that can access only `gugu9999gu/How-much-is-tokens-releases` and grant **Contents: Read and write**. Do not grant broader repository access than needed.
4. In the private development repository open **Settings** → **Secrets and variables** → **Actions** and save the token as `RELEASE_REPO_TOKEN`.

Never commit the token to `settings.json`, `.env`, `.leerness`, workflow YAML, source files, or release notes.

## Publishing flow

`.github/workflows/publish-public-release.yml` builds from the private development repository and publishes only selected artifacts to the public release repository.

A release can be triggered by:

- pushing a version tag such as `v1.0.23`, or
- manually running the workflow with `workflow_dispatch`.

The workflow:

1. checks out the private source inside the Actions runner;
2. installs pinned dependencies and runs the project tests;
3. builds the Windows portable executable;
4. calculates SHA-256;
5. verifies that the public release repository is reachable with `RELEASE_REPO_TOKEN`;
6. initializes only the public release README if the target repository is empty;
7. creates or updates the matching GitHub Release and uploads only the portable executable and `SHA256SUMS.txt`.

No source directory, `.leerness` state, OAuth material, local settings, or private workflow file is uploaded.

## Security boundary

Changing a repository from public to private protects future GitHub access, but it cannot revoke copies that were already cloned, cached, downloaded, or forked while the repository was public. Treat previously published source as already disclosed and rotate any credential if one was ever committed to Git history.
