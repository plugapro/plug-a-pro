#!/bin/bash
# Run Pay@ integration test
# Usage: bash run-payat-test.sh
# (credentials are pre-filled from your Pay@Go account)

cd "$(dirname "$0")"

PAYAT_CLIENT_ID=client-419d4859-fa0c-4e62-b7d5-6ff8916e707d \
PAYAT_CLIENT_SECRET=b2d8b4f8-c27a-4103-b30c-030b9ae46a4f \
PAYAT_WEBHOOK_SECRET=bffebe00d0c1f4be102fe6d024388e0182fc3a1457962813313c12638008e25b \
node payat-test.mjs
