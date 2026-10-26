# 05 · Rent and claims

**You leave with:** rent recorded, holders' shares computed without any list of holders, and a
claim paid once. **Time:** ~10 min.

## How it works

`record_inflow` moves USDC into the income vault and raises a **reward index** by
`amount / profit tokens tracked`. Each holder's **position** remembers the index at its last
update; what they can claim is `accrued + balance × (index now − index then)`. The profit mint's
transfer hook updates both positions on every transfer, so income earned before a transfer stays
with the sender and income after it goes to the receiver.

<p align="center"><img src="../../assets/distribution.svg" alt="Pull distributions" width="100%"></p>

## In the harness

1. As **Operator**, type `1000` under *Operator* and press **Record rent (USDC)**.
2. As **Ana**, see *Claimable rent* in her panel, press **Claim rent**. → ✓ USDC arrives.
3. Press **Claim rent** again → `✗ NothingToClaim` (6034).
4. Send FHP from Ana to Bruno, record rent again, and compare their claimable amounts.

## ✅ Proof

`tests/distribution.test.ts`: pro-rata split with nothing minted; future income moves with the
token; same-owner transfers change nothing; one claim per accrual; a frozen holder keeps accruing
and claims after reinstatement; payouts never exceed recorded income, even across many tiny
inflows; income cannot be recorded before anyone holds.

---
[← 04 · Work and the council](04-work-and-the-council.md) · [06 · Going to devnet →](06-going-to-devnet.md)
