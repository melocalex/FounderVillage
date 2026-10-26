# 06 · Going to devnet

**You leave with:** Founder Village deployed on devnet, where anyone can inspect it in the explorer.
**Time:** ~30 min, most of it waiting for the faucet.

> [!IMPORTANT]
> Devnet only. Testnet has no Solana Attestation Service, so the whitelist gate cannot run there.
> Mainnet needs an external audit and a multisig as upgrade authority first.

## 1. A wallet you keep

The deploy wallet becomes the program's **upgrade authority**. Create it yourself; the seed phrase
is printed only to you.

```bash
solana-keygen new --outfile ~/.config/solana/id.json
solana config set --url devnet
```

## 2. Devnet SOL

The program needs ~4 SOL of refundable rent (~575 KB binary at 5,080 lamports per byte).

```bash
solana airdrop 2   # rate-limited: repeat, or use https://faucet.solana.com with `solana address`
solana balance
```

## 3. Check the program address

`declare_id!` and `Anchor.toml` say `CachxfgQfNcVhvjGGY5KMTSijdP8SVx4MqDxDniyQP6S`. The deploy key
in `target/deploy/founder_village-keypair.json` must produce that address, or a deploy creates a new
program somewhere else:

```bash
solana address -k target/deploy/founder_village-keypair.json
```

Keep a backup of that file outside the repository (`cargo clean` deletes `target/`). It is
git-ignored and must never be committed.

## 4. Deploy

```bash
NO_DNA=1 anchor build
NO_DNA=1 anchor deploy --provider.cluster devnet
```

## 5. Seed it

Devnet already runs the Attestation Service and Squads. One command creates the whitelist
credential, the 2-of-3 council, a USDC stand-in and the asset, then runs the demo scenario:

```bash
npm run devnet:seed
```

Your wallet pays. The demo roles derive from a private seed in `.devnet/seed` (git-ignored), so only
you can act as the devnet council or issuer. The script writes every address to `docs/devnet.md`.

To let a tester use their own wallet, send them devnet SOL instructions and run:

```bash
npm run devnet:onboard -- <their wallet address>
```

It puts the wallet on the whitelist and mints it 10,000 test USDC. A second run keeps the attestation.

## ✅ Proof

```bash
solana program show CachxfgQfNcVhvjGGY5KMTSijdP8SVx4MqDxDniyQP6S --url devnet
```

shows the program, its size and your wallet as upgrade authority. Open it at
`https://explorer.solana.com/address/CachxfgQfNcVhvjGGY5KMTSijdP8SVx4MqDxDniyQP6S?cluster=devnet`.

---
[← 05 · Rent and claims](05-rent-and-claims.md) · [README](../../README.md)
