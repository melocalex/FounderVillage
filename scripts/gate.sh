#!/usr/bin/env bash
# Every check CI runs, in one script, for Docker or a local shell: `npm run gate`.
set -euo pipefail
export NO_DNA=1
step() { printf '\n▸ %s\n' "$*"; }

step "rustfmt"
cargo fmt --check
step "clippy"
cargo clippy --all-targets --locked -- -D warnings
step "arithmetic unit and property tests"
cargo test --locked -p cachain
step "anchor build"
# --ignore-keys: a fresh checkout has no program keypair (git-ignored); declare_id! fixes the ID.
anchor build --ignore-keys
if git rev-parse --git-dir >/dev/null 2>&1; then
  step "generated client matches the IDL"
  npm run -s codama:check
else
  step "generated-client drift check skipped (no git checkout here; CI runs it)"
fi
step "typecheck"
npm run -s typecheck
step "mainnet SAS and Squads binaries (read-only, cached)"
npm run -s fixtures:programs
step "unit tests (LiteSVM)"
npm test
step "end to end (embedded Surfpool)"
npm run -s test:e2e
step "one-command bootstrap"
npx tsx scripts/dev.ts --seed-only
printf '\n✓ all checks passed\n'
