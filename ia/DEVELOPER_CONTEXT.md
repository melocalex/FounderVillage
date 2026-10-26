# Developer context

Read this file before you change code or build a screen. It gives the facts. The order of work is
in [IMPLEMENTATION_GUIDE.md](IMPLEMENTATION_GUIDE.md). The rules for agents are in
[../AGENTS.md](../AGENTS.md).

## 1. What the system does

Founder Village builds a neighborhood one asset at a time. Each asset is one company (an SPV).
Members help to build an asset in two ways: they do work, or they bring capital in USDC. Each
contribution is a bounty. When a bounty is complete, the member gets the asset's tokens. When the
asset earns rent, the token holders get their share.

Cachain is the Solana program that enforces these rules. One program serves all assets.

## 2. The actors

| Actor | What it does | How it signs |
|---|---|---|
| Member | proposes gaps, funds tranches, does work, transfers tokens, claims rent | wallet |
| Council | curates bounties, accepts or rejects work, pauses and closes tranches, sends capital to the SPV | Squads 2-of-3 vault |
| Issuer | puts wallets on the whitelist and removes them | Attestation Service credential signer |
| Operator | pays rent into the asset | wallet |
| Holding | receives 20% of every issuance | wallet |
| Anyone | settles accepted work, freezes wallets that left the whitelist | any wallet |

## 3. The accounts

| Account | Seeds | Contents |
|---|---|---|
| Asset | `"asset"`, creator, asset id | rules, council, holding, SPV treasury, whitelist credential and schema, USDC ledger, reward index |
| Ownership mint | `"mint"`, asset, `0` | Token-2022 mint. Accounts start frozen. |
| Profit mint | `"mint"`, asset, `1` | Token-2022 mint with a transfer hook to Cachain. Accounts start frozen. |
| Capital vault | `"capital"`, asset | USDC from contributions |
| Income vault | `"income"`, asset | USDC from rent |
| Bounty | `"bounty"`, asset, id | kind, state, title, terms, raised, claimant |
| Position | `"position"`, asset, owner | profit balance, reward index, accrued and claimed rent |
| Receipt | `"receipt"`, bounty, contributor, receipt id | one contribution |

All amounts are integers in base units. USDC and both asset tokens use 6 decimals. Use `bigint`.

## 4. The bounty states

```
Proposed → Curated → Open → Claimed → Delivered → Accepted → Settled     (work)
                       Open ⇄ Paused → Settled                           (financial)
                       Delivered → Rejected
Proposed | Curated | Open | Claimed → Cancelled (only without capital)
```

Each arrow is one instruction. A wrong state gives error 6021. A wrong kind gives error 6022.

## 5. The whitelist

Every asset-token account starts frozen. `thaw_holder` unfreezes it only if the owner wallet has a
valid attestation. The attestation comes from the Solana Attestation Service (SAS). When the
attestation is closed or expired, any wallet can call `freeze_holder`. The balance stays with the
owner. The rent keeps accruing.

The UI shows the whitelist status. The UI never decides it. Always send the transaction and show
the program error.

## 6. Rent

`record_inflow` adds rent to the income vault and increases the reward index. A holder can claim
`accrued + balance × (reward index − position index) / 10^12`. The transfer hook moves the balance
with each profit-token transfer. A claim pays once. The program never pays more than it received.

## 7. Clusters and addresses

| Cluster | Use | Addresses |
|---|---|---|
| localnet | development, tests, the harness | printed by `npm run dev` |
| devnet | public demo | [../docs/devnet.md](../docs/devnet.md) |
| mainnet | not deployed | needs an external audit first |

The program address is `CachxfgQfNcVhvjGGY5KMTSijdP8SVx4MqDxDniyQP6S` on all clusters.

## 8. Test tokens

You need three things to test a member flow with a real wallet: SOL for fees, USDC to fund a
tranche, and a whitelist attestation.

| Need | Localnet | Devnet |
|---|---|---|
| SOL | Free. `npm run dev` funds the demo wallets. | `solana airdrop 2`. If the airdrop fails, use <https://faucet.solana.com> (choose devnet, sign in with GitHub for a higher limit). |
| USDC | The demo wallets have 1,000,000 test USDC. | Ask the maintainer to run `npm run devnet:onboard -- <your wallet>`. It sends 10,000 test USDC. |
| Whitelist | Ana and Bruno are on it. Eve is not. | The same `devnet:onboard` command puts your wallet on the whitelist. |

The test USDC is a separate mint, not the real USDC. It has no value. Testnet does not work: the
Attestation Service is not deployed on testnet.

## 9. Where the code is

| Path | Contents |
|---|---|
| `programs/cachain/src/` | the Anchor program |
| `clients/ts/src/generated/cachain/` | the generated client. Do not edit. |
| `clients/ts/src/protocol.ts` | builders that fill every account |
| `clients/ts/src/squads.ts` | the council flow |
| `clients/ts/src/attestations.ts` | the whitelist flow |
| `app/src/` | the test harness. Use it as a reference. |
| `tests/` | one test file per flow |

## 10. Rules that protect money

1. Use the generated client. Never encode an instruction or decode an account by hand.
2. Never put a private key in the frontend, a log or a commit.
3. Show the program error. Never hide it and never guess the result.
4. Use `bigint` for amounts. Format only when you show the value.
5. Before you resend a transaction after an error, read its status. Send again only if it did not land.
