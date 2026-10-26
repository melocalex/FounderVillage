# 01 · Run it locally

**You leave with:** a local Solana network running Founder Village, seeded with Founder Haus, and the test
harness open in your browser. **Time:** ~15 min (first build), ~1 min after.

## Option A: your machine

| You need | For |
|---|---|
| Node ≥ 22.12 | the client, tests and harness |
| Rust ≥ 1.89, Solana CLI 4.1.2, Anchor 1.2.1 | building the program (a fresh clone always builds it once) |

```bash
git clone https://github.com/melocalex/foundervillage && cd foundervillage
npm install --ignore-scripts
npm run dev
```

## Option B: Docker (no local toolchain)

```bash
docker compose up dev
```

The image pins every tool. On Apple Silicon it runs as `linux/amd64` (Surfpool ships no Linux
arm64 binary), so the first build is slow.

## ✅ Proof

The terminal prints a table of addresses (program, asset, mints, council, members, bounties) and
`Local Founder Haus is up`. Open **http://localhost:5183**: Ana appears as *verified* and *thawed*,
the tranche shows 10,000 of 300,000 USDC raised, and Ana has rent to claim.

## What you are looking at

| Persona | Role |
|---|---|
| Ana, Bruno | whitelisted members |
| Eve | not on the whitelist: everything she tries should fail |
| Operator | pays rent in |
| Holding | receives its share of every issuance |
| Council A, B, C | the 2-of-3 Squads council |
| Issuer | attests and revokes members |

Every action you take lands in **Activity** on the right, with the instructions sent, the
signature, the fields that changed on-chain, and the exact error when it fails.

## If it fails

- `missing target/deploy/founder_village.so`: install the Rust toolchain (Option A) or use Docker.
- Port 5183 busy: stop the other process; the harness uses a fixed port.
- Fixtures fail to download: set `MAINNET_RPC_URL` to a private endpoint and retry.

---
[← 00 · New to Solana](00-new-to-solana.md) · [02 · The whitelist →](02-the-whitelist.md)
