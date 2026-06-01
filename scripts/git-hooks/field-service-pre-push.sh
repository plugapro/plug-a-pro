#!/usr/bin/env bash
set -euo pipefail

zero_sha="0000000000000000000000000000000000000000"
repo_root="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"

cd "$repo_root"

collect_changed_files() {
  if [[ -n "${FIELD_SERVICE_PRE_PUSH_FILES:-}" ]]; then
    printf '%s\n' "$FIELD_SERVICE_PRE_PUSH_FILES"
    return
  fi

  if [[ -n "${FIELD_SERVICE_PRE_PUSH_RANGE:-}" ]]; then
    git diff --name-only "$FIELD_SERVICE_PRE_PUSH_RANGE"
    return
  fi

  local saw_ref=0
  while read -r local_ref local_sha remote_ref remote_sha; do
    saw_ref=1

    if [[ "$local_sha" == "$zero_sha" ]]; then
      continue
    fi

    if [[ "$remote_sha" == "$zero_sha" ]]; then
      local default_remote base_sha
      default_remote="$(git symbolic-ref --quiet --short refs/remotes/origin/HEAD 2>/dev/null || true)"
      base_sha=""

      if [[ -n "$default_remote" ]]; then
        base_sha="$(git merge-base "$default_remote" "$local_sha" 2>/dev/null || true)"
      fi

      if [[ -n "$base_sha" ]]; then
        git diff --name-only "$base_sha..$local_sha"
      else
        git diff-tree --no-commit-id --name-only -r "$local_sha"
      fi
    else
      git diff --name-only "$remote_sha..$local_sha"
    fi
  done

  if [[ "$saw_ref" -eq 0 ]]; then
    local upstream
    upstream="$(git rev-parse --abbrev-ref --symbolic-full-name '@{u}' 2>/dev/null || true)"
    if [[ -n "$upstream" ]]; then
      git diff --name-only "$upstream..HEAD"
    else
      git diff --name-only HEAD
    fi
  fi
}

changed_files="$(collect_changed_files | sed '/^[[:space:]]*$/d' | sort -u)"
field_files="$(printf '%s\n' "$changed_files" | sed -n '/^field-service\//p')"

if [[ -z "$field_files" ]]; then
  echo "field-service pre-push: no field-service changes detected; skipping."
  exit 0
fi

tests=()

add_test() {
  local test_file="$1"
  if [[ -f "field-service/$test_file" ]]; then
    tests+=("$test_file")
  fi
}

add_generic_lib_test() {
  local file="$1"
  local rel="${file#field-service/lib/}"
  local base="${rel%.*}"

  add_test "__tests__/lib/$base.test.ts"
  add_test "__tests__/lib/$base.test.tsx"
}

while IFS= read -r file; do
  case "$file" in
    field-service/__tests__/*.test.ts|field-service/__tests__/*.test.tsx)
      add_test "${file#field-service/}"
      ;;
    field-service/app/api/webhooks/verification/*|field-service/lib/identity-verification/vendors/didit/*)
      add_test "__tests__/api/verification-webhook-route.test.ts"
      add_test "__tests__/lib/identity-verification/vendors/didit/signing.test.ts"
      add_test "__tests__/lib/identity-verification/vendors/didit/parse.test.ts"
      add_test "__tests__/lib/identity-verification/vendors/didit/normalize.test.ts"
      add_test "__tests__/lib/identity-verification/vendors/didit/session.test.ts"
      ;;
    field-service/lib/identity-verification/*)
      add_generic_lib_test "$file"
      add_test "__tests__/lib/identity-verification/orchestrator.test.ts"
      ;;
    field-service/lib/whatsapp-flows/identity-verification.ts)
      add_test "__tests__/lib/whatsapp-flows/identity-verification.test.ts"
      ;;
    field-service/app/*admin/verifications/vendors*|field-service/app/*admin/verifications/actions*)
      add_test "__tests__/app/admin-verification-vendors-actions.test.ts"
      add_test "__tests__/admin/didit-verification-actions.test.ts"
      ;;
    field-service/lib/otp-security*|field-service/lib/whatsapp-otp-report.ts|field-service/app/api/security/otp/*)
      add_test "__tests__/api/security-otp-report.test.ts"
      add_test "__tests__/lib/otp-security.test.ts"
      add_test "__tests__/lib/otp-security-signals.test.ts"
      add_test "__tests__/lib/whatsapp-otp-report.test.ts"
      ;;
    field-service/app/api/auth/provider/send-code/route.ts)
      add_test "__tests__/api/provider-send-code-security.test.ts"
      add_test "__tests__/api/auth/provider-verify-code-gate.test.ts"
      ;;
    field-service/app/api/auth/hooks/send-sms/*)
      add_test "__tests__/api/auth/hooks/send-sms.test.ts"
      add_test "__tests__/api/auth/hooks/send-sms-security-check.test.ts"
      add_test "__tests__/api/auth/hooks/send-sms-security-gate.test.ts"
      ;;
    field-service/lib/provider-credit*|field-service/app/api/provider/wallet/top-up-intents/*)
      add_generic_lib_test "$file"
      add_test "__tests__/api/provider-credit-top-up-intents.test.ts"
      add_test "__tests__/lib/provider-credit-balance-and-ledger-flow.test.ts"
      ;;
    field-service/lib/*.ts|field-service/lib/**/*.ts|field-service/lib/*.tsx|field-service/lib/**/*.tsx)
      add_generic_lib_test "$file"
      ;;
  esac
done <<< "$field_files"

if [[ -n "${FIELD_SERVICE_FOCUSED_TESTS:-}" ]]; then
  while IFS= read -r override_test; do
    [[ -n "$override_test" ]] && add_test "$override_test"
  done <<< "$FIELD_SERVICE_FOCUSED_TESTS"
fi

unique_tests="$(printf '%s\n' ${tests[@]+"${tests[@]}"} | sed '/^[[:space:]]*$/d' | sort -u)"

if [[ -z "$unique_tests" ]]; then
  unique_tests="__tests__/api/health.test.ts"
  echo "field-service pre-push: no mapped focused tests found; running health smoke test."
fi

echo "field-service pre-push: running pnpm typecheck"
(cd field-service && pnpm typecheck)

echo "field-service pre-push: running pnpm lint"
(cd field-service && pnpm lint)

echo "field-service pre-push: running focused tests"
printf '%s\n' "$unique_tests" | sed 's/^/  - /'

(
  cd field-service
  pnpm exec vitest run $unique_tests
)
