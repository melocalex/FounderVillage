# 03 · Fund a tranche

**You leave with:** a USDC contribution that mints ownership and profit tokens in the same
transaction, and the holding's share minted alongside. **Time:** ~10 min.

## How it works

A tranche is a **financial bounty**. The council fixed its price, target and optional deadline at
curation. `contribute` moves USDC into the asset's capital vault and mints
`amount × price_num / price_den` tokens of each kind to the contributor, plus the holding's share
(20%: for every 800 to a member, 200 to the holding). A receipt account records it.

## In the harness

1. Act as **Ana**. On *Tranche 2*, type `1000` and press **Fund (USDC)**. → ✓; Activity shows her FHO and FHP balances up by 1,000 and the capital ledger up by 1,000 USDC.
2. Type `400000` and fund again. → `✗ ExceedsTarget` (6028).
3. Act as **Council A**, press **Pause** on the tranche; as **Council B**, **Approve**, then **Execute**. As Ana, fund again → `✗ InvalidBountyState` (6021). **Resume** the same way.

## In code

```ts
await client.sendTransaction([await contributeInstruction(asset, bounty, wallet, 1_000_000_000n, receiptId)]);
```

## ✅ Proof

`tests/funding.test.ts`: minted at the curated price in the same transaction; the holding's ratio
holds after mixed issuances; target, deadline, pause, resume and close behave; one council key
cannot pause, resume or close; the vault equals contributions minus recorded outflows, and a stray
transfer changes no accounting.

---
[← 02 · The whitelist](02-the-whitelist.md) · [04 · Work and the council →](04-work-and-the-council.md)
