# 02 · The whitelist

**You leave with:** a member who can hold the asset, a wallet that cannot, and a revocation that
takes effect in one transaction. **Time:** ~10 min.

## How it works

Every asset-token account is born **frozen**. `thaw_holder` unfreezes it only when the owner's
wallet has a live attestation from the issuer (Solana Attestation Service), under the credential
and schema the asset pinned at creation. The program re-derives where that attestation must live,
so nobody can present someone else's.

## In the harness

1. Act as **Eve** and press **Join (thaw accounts)**. → `✗ NotEligible` (6016).
2. Act as **Issuer**, press **Attest** next to Eve. Act as **Eve**, **Join** again. → ✓, both accounts *thawed*.
3. As **Issuer**, press **Revoke + freeze** next to Eve. → ✓, her accounts are *frozen* again in the same transaction. Her balance does not change.

## In code

```ts
import { joinInstructions, revokeAndFreezeInstructions } from './clients/ts/src';

await client.sendTransaction(await joinInstructions(rpc, asset, wallet, payer)); // only the missing steps
await client.sendTransaction(await revokeAndFreezeInstructions(asset, payer, issuer, wallet));
```

## ✅ Proof

`tests/gate.test.ts`: a non-whitelisted wallet cannot be thawed or receive the token; someone else's
attestation is refused; an account whose owner could be reassigned is refused; anyone can freeze a
revoked or expired holder; revoke and freeze happen atomically.

## If it fails

| Error | Meaning |
|---|---|
| 6016 NotEligible | no attestation for this wallet, or it was revoked |
| 6015 AttestationExpired | renew the attestation |
| 6040 MutableOwner | use the associated token account, not a custom one |
| 6018 AlreadyThawed | nothing to do |

---
[← 01 · Run it](01-run-it.md) · [03 · Fund a tranche →](03-fund-a-tranche.md)
