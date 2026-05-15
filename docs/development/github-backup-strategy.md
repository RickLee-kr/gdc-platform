# GitHub repository backup and hygiene strategy

This document complements [PostgreSQL backup and restore](../admin/backup-restore.md) by focusing on **Git history**, **`.gitignore` coverage**, and **safe use of GitHub as a long-term source backup**. It does not change application runtime architecture.

## Goals

- Keep the default branch and tags **reproducible** from git alone (source, specs, migrations, tooling).
- Ensure **secrets, TLS private keys, database dumps, and generated backups** are not committed going forward.
- Understand that **git history is immutable** unless you rewrite it; remediation for past leaks is a separate, deliberate process.

## Branch strategy

- **`main` (or `master`)**: protected default branch; merge only via reviewed PRs. CI required where applicable.
- **Short-lived feature branches**: `feat/…`, `fix/…`, `chore/…` from the default branch; delete after merge.
- **Release branches (optional)**: `release/x.y` only when you need to patch an older line without merging all of `main` (e.g. hotfix on last minor).

Avoid long-lived personal branches on the canonical remote; fork or use a second remote for experiments if needed.

## Releases and tags

- Tag **immutable release points** with annotated tags, e.g. `v1.4.0`, after CI passes on the release commit.
- Prefer **tagging the exact merge commit** (or release-branch tip) that was validated, not a moving branch tip.
- Document breaking changes and migration steps in the tag message or release notes; do not paste production secrets or full `DATABASE_URL` values.

## Backup strategy (GitHub-centric)

- **Primary backup**: GitHub (or your organisation’s mirror) retains objects and refs; clone/fetch any machine with credentials.
- **Secondary backup**: periodic **bare mirror** clones to controlled storage (encrypted at rest), e.g. scheduled `git clone --mirror` or vendor export, so loss of one host does not lose history.
- **Scope**: git backs up **versioned source and docs**; it does **not** replace database backups, object storage, or runtime secrets stores.

## Restore workflow (from git)

1. Clone or fetch the desired ref: `git clone <url>` or `git fetch origin && git checkout <tag>`.
2. Restore **runtime configuration** from your secrets manager / vault (not from git): `.env`, TLS files under `deploy/tls/`, `data/tls/`, etc.
3. Apply database schema with Alembic and restore data using [backup-restore](../admin/backup-restore.md) when needed.
4. Rebuild or install dependencies (`pip`, `npm ci` under `frontend/`) per `README.md` and lockfiles.

## Handling secrets safely

- **Never** commit `.env`, private keys, `*.pem` / `*.key` / `*.crt` used in production, raw `pg_dump` files, or support bundles containing operational data.
- Prefer **environment variables**, **secret managers**, and **bind-mounted files** excluded by `.gitignore` (see root `.gitignore` for `deploy/tls/*`, `data/tls/`, dumps, `var/backups/`, etc.).
- If a secret was **ever** committed, assume it is compromised: **rotate** the credential and treat git history as potentially exposed until remediated (see below). Do not paste secrets into issues, PRs, or chat.

## Force-push and history rewrite (use with extreme caution)

- **`git push --force`** (or `--force-with-lease`) rewrites remote history for the affected ref. Coordinators and automation relying on old SHAs will break.
- **History rewrite** (`git filter-repo`, BFG, interactive rebase + force-push) can remove blobs from **new** history but **does not erase copies** already fetched, forked, or mirrored. Treat leaked secrets as leaked until rotated.
- Prefer **`git rm --cached`** for “stop tracking but keep local file” without rewriting past commits.
- Organisation policy may **forbid** force-push on `main`; follow local rules and announce maintenance windows before rewriting shared branches.

## Verification commands

Run from the repository root.

### List tracked paths (audit what Git will ship)

```bash
git ls-files
```

Narrow examples (shell patterns):

```bash
git ls-files '*.env*' 'deploy/tls/*' '*.pem' '*.key' '*.crt' '*.dump*' 'var/backups/*'
```

### Confirm ignore rules (why a path is ignored or not)

```bash
git check-ignore -v path/to/file
```

### Search history for risky filenames (does not print file contents)

Prefer **name** searches first; avoid piping `git log -p` into public logs if you might accidentally expose recovered secrets.

```bash
git log --all --full-history -- .env
git log --all --full-history -- deploy/tls/
git log --all --full-history -- '*.pem'
```

### Find commits that introduced a path

```bash
git log --diff-filter=A --summary -- .env
```

### After fixing tracking: stop tracking without deleting the working tree file

```bash
git rm -r --cached path/to/dir
```

Then commit the change; the file remains locally if present, and new clones will not receive it on that commit **forward** (past commits still contain the blob until history is rewritten).

## Related documentation

- [PostgreSQL backup and restore](../admin/backup-restore.md)
- [HTTPS / reverse proxy TLS](../deployment/https-reverse-proxy.md) (operator TLS layout)
