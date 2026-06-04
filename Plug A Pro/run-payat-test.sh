#!/bin/bash
# Run Pay@ integration test
# Usage: bash run-payat-test.sh
# Credentials must be supplied through your shell environment.

cd "$(dirname "$0")"

PAYAT_CLIENT_ID="${PAYAT_CLIENT_ID:?Set PAYAT_CLIENT_ID before running}" \
PAYAT_CLIENT_SECRET="${PAYAT_CLIENT_SECRET:?Set PAYAT_CLIENT_SECRET before running}" \
PAYAT_WEBHOOK_SECRET="${PAYAT_WEBHOOK_SECRET:?Set PAYAT_WEBHOOK_SECRET before running}" \
node payat-test.mjs
