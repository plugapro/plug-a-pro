#!/usr/bin/env bash
# Vercel "Ignored Build Step" — gates the production build on
# `.github/workflows/migrate-deploy.yml` succeeding for the same commit.
#
# Vercel calls this script before building. The exit code controls what
# happens next (see https://vercel.com/docs/projects/overview#ignored-build-step):
#   exit 1 → proceed with build & deploy
#   exit 0 → skip this deploy (Vercel marks the deploy as "Canceled —
#             Build skipped by Ignored Build Step")
#
# Configure in Vercel Dashboard:
#   Project Settings → Git → Ignored Build Step →
#     bash field-service/scripts/vercel-ignored-build-step.sh
#
# Required Vercel env vars (auto-injected; nothing to add):
#   VERCEL_ENV                    — "production" | "preview" | "development"
#   VERCEL_GIT_COMMIT_SHA         — full SHA of the commit being deployed
#   VERCEL_GIT_REPO_OWNER         — "plugapro"
#   VERCEL_GIT_REPO_SLUG          — "plug-a-pro"
#
# Optional override (set in Vercel Dashboard if you want public-API polling):
#   GH_API_TOKEN                  — a fine-grained PAT with read access to
#                                   Actions on plugapro/plug-a-pro. Without
#                                   it, this script polls the public Actions
#                                   API (60 req/hr per IP — usually fine
#                                   because we poll at most ~12 times per
#                                   deploy).

set -euo pipefail

log() { echo "[ignored-build-step] $*" >&2; }

decide_proceed() { log "decision: PROCEED with build"; exit 1; }
decide_skip()    { log "decision: SKIP build (deploy canceled)"; exit 0; }

# Preview and development deploys always proceed. Migration gating is a
# production-only concern; previews run against a different DB anyway (or
# none at all if the test runner is mocked).
if [[ "${VERCEL_ENV:-}" != "production" ]]; then
  log "VERCEL_ENV='${VERCEL_ENV:-unset}' — non-production deploy, proceeding"
  decide_proceed
fi

owner="${VERCEL_GIT_REPO_OWNER:-plugapro}"
repo="${VERCEL_GIT_REPO_SLUG:-plug-a-pro}"
sha="${VERCEL_GIT_COMMIT_SHA:-}"
workflow_file="migrate-deploy.yml"

if [[ -z "$sha" ]]; then
  log "VERCEL_GIT_COMMIT_SHA missing — cannot identify the commit; proceeding to avoid blocking on bad config"
  decide_proceed
fi

# Check whether this commit even touched a migration. If it didn't, the
# migrate-deploy workflow's path filter skipped it and we should proceed
# immediately. We look at the merged tree to see if any migration file
# changed in the commit.
#
# We treat git as the source of truth here, not GitHub's API: the API does
# expose changed-files-per-commit, but we already have the repo cloned in
# Vercel's build container before this script runs.
if git rev-parse HEAD >/dev/null 2>&1; then
  if ! git diff --name-only "${sha}~1" "${sha}" 2>/dev/null | grep -qE '^field-service/prisma/(migrations/|schema\.prisma$)'; then
    log "commit ${sha:0:8} touched no migration files; proceeding without waiting for migrate-deploy"
    decide_proceed
  fi
fi

# Build the GitHub Actions API URL. Use Bearer auth when a PAT is available;
# fall back to anonymous for the public Actions API (lower rate-limit).
api="https://api.github.com/repos/${owner}/${repo}/actions/workflows/${workflow_file}/runs?head_sha=${sha}&per_page=5"
auth_header=()
if [[ -n "${GH_API_TOKEN:-}" ]]; then
  auth_header=(-H "Authorization: Bearer ${GH_API_TOKEN}")
fi
common_headers=(
  -H "Accept: application/vnd.github+json"
  -H "X-GitHub-Api-Version: 2022-11-28"
  -H "User-Agent: plug-a-pro-vercel-ignored-build-step"
)

# Poll up to 6 minutes total — long enough for the migrate-deploy job to
# finish its install + migrate deploy (median ~2-3 min on this repo).
max_polls=24
sleep_seconds=15

for attempt in $(seq 1 "$max_polls"); do
  response=$(curl -fsSL "${auth_header[@]}" "${common_headers[@]}" "$api" 2>/dev/null || true)
  if [[ -z "$response" ]]; then
    log "attempt ${attempt}/${max_polls}: GitHub API unreachable; retrying in ${sleep_seconds}s"
    sleep "$sleep_seconds"
    continue
  fi

  # `.workflow_runs[0]` is the most recent run on this SHA. Newest first.
  status=$(printf '%s' "$response" | grep -E '"status":\s*"' | head -1 | sed -E 's/.*"status":\s*"([^"]+)".*/\1/' || true)
  conclusion=$(printf '%s' "$response" | grep -E '"conclusion":\s*"' | head -1 | sed -E 's/.*"conclusion":\s*"([^"]+)".*/\1/' || true)

  if [[ -z "$status" ]]; then
    log "attempt ${attempt}/${max_polls}: no migrate-deploy run found for ${sha:0:8} yet; retrying in ${sleep_seconds}s"
    sleep "$sleep_seconds"
    continue
  fi

  log "attempt ${attempt}/${max_polls}: status=${status} conclusion=${conclusion:-pending}"

  if [[ "$status" == "completed" ]]; then
    case "$conclusion" in
      success)        decide_proceed ;;
      skipped|neutral) decide_proceed ;;
      *)
        log "migrate-deploy concluded with '${conclusion}' — skipping production build"
        decide_skip
        ;;
    esac
  fi

  sleep "$sleep_seconds"
done

log "migrate-deploy did not complete within $((max_polls * sleep_seconds))s; skipping production build to avoid deploying ahead of schema"
decide_skip
