# AGENTS.md

Cachain puts a Founder Village asset (an SPE that owns a building) on Solana. Each asset has two
Token-2022 tokens, **ownership** and **profit**, whose accounts are born frozen: only wallets with a
live Solana Attestation Service attestation get thawed. Tokens are minted only through **bounties**:
a financial bounty mints as USDC arrives, a work bounty mints when the council accepts the delivery.
Rent paid in with `record_inflow` is claimable pro rata by profit holders. The council is a 2-of-3
Squads vault.

## Run it

```bash
npm install --ignore-scripts && npm run dev
```

Builds the program if needed, fetches the SAS and Squads binaries (read-only), boots an offline
Surfpool, deploys, seeds the fixtures below, prints every address, and serves the test harness on
http://localhost:5183. The RPC URL is written to `app/public/localnet.json`.

Seeded fixtures (deterministic, from the public seed `cachain-localnet-demo-v1` in `clients/ts/src/demo.ts`):
an eligible funded member (`ana`), an eligible member (`bruno`), a non-whitelisted wallet (`eve`),
the operator who pays rent, the holding, three council members, the asset with both mints, an open
tranche with one contribution, an open work bounty, and one claimable distribution.

## Where things are

| What | Path |
|---|---|
| Generated client (Codama, Kit 8) | `clients/ts/src/generated/cachain`. Import from `clients/ts/src` |
| Account resolution and builders | `clients/ts/src/protocol.ts` (`joinInstructions`, `contributeInstruction`, `claimDistributionInstruction`, …) |
| Council (Squads) flow | `clients/ts/src/squads.ts` (`councilAction` → `propose`, `approve`, `execute`) |
| Attestations | `clients/ts/src/attestations.ts` |
| IDL | `idl/cachain.json` |
| Policy numbers | `config/founder-haus.json` |
| Test harness (reference only) | `app/src/harness.ts`, `app/src/App.tsx` |

## Program IDs

| Cluster | Cachain | Notes |
|---|---|---|
| localnet | `CachxfgQfNcVhvjGGY5KMTSijdP8SVx4MqDxDniyQP6S` | deployed by `npm run dev` |
| devnet | `CachxfgQfNcVhvjGGY5KMTSijdP8SVx4MqDxDniyQP6S` | **not deployed yet** |
| mainnet | none | not deployed; needs an audit first |

External: SAS `22zoJMtdu4tQc2PzL74ZUT7FrwgB1Udec8DdW4yw4BdG`, Squads v4 `SQDS4ep65T869zMMBKyuUq6aD6EgTu8psMjkvj52pCf`, Token-2022 `TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb`.

## Three rules that are not negotiable

1. **Use the generated client.** Never hand-encode an instruction or decode an account. Regenerate with `npm run codama`.
2. **Never put a keypair in the frontend.** Users sign with a wallet (`@solana/kit-plugin-wallet`). The demo keys exist only in the harness and refuse to run on mainnet, devnet or testnet.
3. **The chain decides eligibility, not the UI.** Show attestation status, but always let the program accept or reject (`thaw_holder`, `contribute`, `claim_distribution`) and show its error.

## Instructions

Signer = who must sign. "council" means the Squads vault: build the instruction with
`council: createNoopSigner(vault)` and send it through `councilAction` (one member proposes, a
second approves, any member executes).

| Instruction | Signer | Does |
|---|---|---|
| `create_asset`, `create_mints` | creator | asset account, USDC vaults, both mints (setup, once) |
| `open_position` | anyone (payer) | creates the holder's distribution position |
| `thaw_holder` | anyone | thaws an attested holder's associated token account |
| `freeze_holder` | anyone | freezes a holder whose attestation is gone or expired |
| `propose_bounty` | eligible member | names a gap: kind, title, spec hash |
| `curate_bounty` | council | writes the terms, once |
| `open_bounty`, `pause_bounty`, `resume_bounty`, `close_funding`, `cancel_bounty` | council | state transitions |
| `contribute` | eligible member | USDC into the capital vault; mints ownership + profit and the holding share |
| `claim_bounty`, `submit_delivery` | eligible member (the claimant) | work bounty |
| `accept_delivery`, `reject_delivery` | council | work bounty |
| `settle_work` | anyone | mints the curated reward to the claimant |
| `record_inflow` | payer of the rent | USDC into the income vault; raises every profit holder's claim |
| `record_outflow` | council | capital to the pinned SPE treasury |
| `claim_distribution` | eligible holder | pays accrued income |
| `execute` | Token-2022 only | transfer hook of the profit mint; never call it |

A member needs `joinInstructions(rpc, asset, wallet, payer)` once: it creates both associated token
accounts, opens the position and thaws both accounts. Profit-token transfers need the hook's extra
accounts: build them with `getTransferCheckedWithTransferHookInstructionAsync` from
`@solana-program/token-2022`.

## Errors

Program errors arrive as `Custom(code)`. `findCustomError(error)` in `clients/ts/src/errors.ts`
extracts the code from any Kit error; `describeError(code)` names it.

| Code | Name | What the UI should say |
|---|---|---|
| 6000 | NotCouncil | Only the council can do this. |
| 6001 | AssetNotLive | This asset is not open yet. |
| 6002 | AssetAlreadyLive | Setup already ran. |
| 6003 | InvalidHoldingBps | Setup error: holding share must be below 100%. |
| 6004 | MetadataTooLong | Setup error: token name, symbol or URI too long. |
| 6005 | InvalidTitle | Give the bounty a title of 1 to 64 characters. |
| 6006 | WrongMint | Wrong token for this asset (client bug). |
| 6007 | WrongHoldingAccount | Wrong holding account (client bug). |
| 6008 | WrongPosition | Wrong position account (client bug). |
| 6009 | WrongAttestationAddress | Attestation does not belong to this wallet (client bug or misuse). |
| 6010 | AttestationWrongOwner | Attestation account is not from the Attestation Service. |
| 6011 | AttestationMalformed | Attestation data could not be read. |
| 6012 | AttestationWrongCredential | Wrong credential account (client bug). |
| 6013 | AttestationWrongSchema | Attestation was issued under another schema. |
| 6014 | AttestationWrongSubject | Attestation names another wallet. |
| 6015 | AttestationExpired | Your verification expired. Renew it to continue. |
| 6016 | NotEligible | This wallet is not on the member whitelist. |
| 6017 | StillEligible | This holder is still verified; nothing to freeze. |
| 6018 | AlreadyThawed | Already active. |
| 6019 | AlreadyFrozen | Already frozen. |
| 6020 | HolderFrozen | Account inactive: complete verification (join) first. |
| 6021 | InvalidBountyState | This bounty is not at that step. Refresh. |
| 6022 | WrongBountyKind | Not available for this kind of bounty. |
| 6023 | InvalidReward | Work bounty needs a positive reward. |
| 6024 | InvalidPrice | Tranche needs a positive price. |
| 6025 | InvalidTarget | Tranche needs a positive target. |
| 6026 | InvalidDeadline | Deadline must be in the future. |
| 6027 | ZeroAmount | Enter an amount above zero. |
| 6028 | ExceedsTarget | That is more than the tranche still accepts. |
| 6029 | DeadlinePassed | This tranche is closed. |
| 6030 | ZeroTokens | Amount too small to buy any tokens. |
| 6031 | FundsRaised | Capital was raised; close the tranche instead of cancelling. |
| 6032 | NotClaimant | Only the member who claimed this bounty can deliver it. |
| 6033 | EmptyDelivery | Attach the delivery. |
| 6034 | NothingToClaim | Nothing to claim yet. |
| 6035 | ExceedsCapital | More than the recorded capital. |
| 6036 | WrongTreasury | Capital can only go to the SPE treasury. |
| 6037 | WrongVault | Wrong vault (client bug). |
| 6038 | MathOverflow | Amount out of range. |
| 6039 | NotTransferring | (never shown: hook misuse) |
| 6040 | MutableOwner | Use your associated token account. |
| 17 | Token-2022 AccountFrozen | The recipient is not a verified member. |
| 2000–2999 | Anchor constraint errors | A wrong account was passed (client bug). |
| 6004–6010 from SQDS4… | Squads errors | e.g. 6008 InvalidProposalStatus: the proposal needs more approvals. |

## Read-only data guide

| Screen | Fetch | Show |
|---|---|---|
| Asset overview | `fetchAsset(rpc, asset)`; balances of `capitalVault` and `incomeVault` | `ledger.contributed`, `ledger.outflow`, `ledger.income`, `ledger.incomeClaimed`, `holdingBps`, mints |
| Member status | `holderAccounts(asset, wallet)` → `fetchMaybeAttestation`, `fetchMaybeToken` × 2, `fetchMaybePosition` | verified or not and expiry; each token account frozen/thawed and balance |
| Claimable income | position + asset | `accrued + balance × (asset.distribution.rewardIndex − position.index) / 10^12` |
| Bounties | ids `0 … asset.nextBountyId − 1` → `findBountyPda` → `fetchAllBounty` | `kind`, `state`, `title`, `terms`, `raised`, `claimant` |
| Tranche progress | bounty | `raised / terms.target`, `terms.deadline` (0 = none) |
| My contributions | `Receipt` accounts: `getProgramAccounts` with a memcmp on `contributor` (offset 40), on a private RPC or an indexer | `amount`, `tokens`, `timestamp` |
| Activity feed | `#[event_cpi]` events in inner instructions; decode with `identifyCachainEvent` | never parse logs |

All amounts are `bigint` base units (6 decimals for USDC and both asset tokens). Format only at the edge.

## Environment

`.env.example` lists every variable by name. Nothing in this repository needs a secret to run locally.
