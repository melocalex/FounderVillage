# 06 · Going to devnet

**You leave with:** Cachain deployed on devnet, where anyone can inspect it in the explorer.
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
in `target/deploy/cachain-keypair.json` must produce that address, or a deploy creates a new
program somewhere else:

```bash
solana address -k target/deploy/cachain-keypair.json
```

Keep a backup of that file outside the repository (`cargo clean` deletes `target/`). It is
git-ignored and must never be committed.

## 4. Deploy

```bash
NO_DNA=1 anchor build
NO_DNA=1 anchor deploy --provider.cluster devnet
```

## 5. Seed it

Devnet already runs the Attestation Service and Squads. A devnet seed script that creates the
credential, the council and the asset with a devnet USDC stand-in is the next piece of work; until
it lands, `npm run dev` remains the full demo.

## ✅ Proof

```bash
solana program show CachxfgQfNcVhvjGGY5KMTSijdP8SVx4MqDxDniyQP6S --url devnet
```

shows the program, its size and your wallet as upgrade authority. Open it at
`https://explorer.solana.com/address/CachxfgQfNcVhvjGGY5KMTSijdP8SVx4MqDxDniyQP6S?cluster=devnet`.

---
[← 05 · Rent and claims](05-rent-and-claims.md) · [README](../../README.md)
