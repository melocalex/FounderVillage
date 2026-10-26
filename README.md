<p align="center"><img src="assets/hero.svg" alt="Founder Village: real-world assets, owned by the people who build them" width="100%"></p>
<p align="center">
  <b>Members earn a Founder Village asset's tokens by delivering work or capital. Only whitelisted wallets can hold them, and rent paid into the asset is shared among holders on-chain.</b><br>
  <a href="docs/guide/01-run-it.md"><b>Start</b></a> · <a href="docs/CONTRACTS.md">How the contracts work</a> · <a href="docs/guide/00-new-to-solana.md">New to Solana</a> ·
  <a href="AGENTS.md">Frontend handoff</a> · <a href="AGENTS.md#errors">Errors</a> · <a href="docs/DECISIONS.md">Decisions</a> · <a href="docs/ENGINEERING.md">Engineering notes</a>
</p>
<p align="center">
  <a href="https://github.com/melocalex/foundervillage/actions/workflows/ci.yml"><img src="https://github.com/melocalex/foundervillage/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <img src="https://img.shields.io/badge/Anchor-1.2.1-512BD4" alt="Anchor 1.2.1">
  <img src="https://img.shields.io/badge/Solana_CLI-4.1.2-14F195" alt="Solana CLI 4.1.2">
  <img src="https://img.shields.io/badge/Token--2022-frozen_by_default-9945FF" alt="Token-2022">
  <img src="https://img.shields.io/badge/%40solana%2Fkit-8.5_·_tx_v1-1E1E1E" alt="Kit 8.5, transaction v1">
  <img src="https://img.shields.io/badge/license-Apache--2.0-blue" alt="Apache-2.0">
</p>

> **Founder Village** is a curated community of founders in Jurerê Internacional, Florianópolis,
> building its neighborhood one asset at a time and owning what it builds. This repository is its
> on-chain protocol on Solana. Each asset sits in its own SPV. Members deliver **work** or **capital** through
> bounties and receive the asset's tokens only when the delivery is real. **Not technical?** Read
> [How the contracts work](docs/CONTRACTS.md): one page, no code. **Very technical?** Read
> [Engineering notes](docs/ENGINEERING.md): the distribution math and its proofs, overflow bounds,
> measured compute per instruction, the pinned toolchain and the review history.

## Running in 3 steps

| You need | For |
|---|---|
| **Node ≥ 22.12** | the client, the tests and the harness |
| **Rust ≥ 1.89, Solana CLI 4.1.2, Anchor 1.2.1**, or **Docker** | building the program (a fresh clone builds it once) |

```bash
# 1. Clone
git clone https://github.com/melocalex/foundervillage && cd foundervillage

# 2. Install
npm install --ignore-scripts

# 3. Run: builds, boots an offline Surfpool, deploys, seeds Founder Haus, serves the harness
npm run dev
```

No toolchain? `docker compose up dev` does the same in a pinned image.

Saw `Local Founder Haus is up`? Open **http://localhost:5183** and, in the harness:

1. As **Eve**, press **Join**: the gate refuses with `NotEligible`. She is not on the whitelist.
2. As **Bruno**, on the rooftop bounty, press **Claim**, then **Submit delivery**.
3. As **Council A**, press **Accept**; as **Council B**, **Approve**, then **Execute**.
4. Press **Settle**: Bruno's tokens mint, and the holding's share mints with them.
5. As **Operator**, **Record rent**; as **Ana**, **Claim rent**. Claim again: `NothingToClaim`.

<p align="center">
  <img src="assets/harness.png" alt="The test harness: personas with whitelist state, asset totals, a bounty board, the council inbox and an activity timeline" width="900">
</p>

Something failed? Start at [Run it · If it fails](docs/guide/01-run-it.md#if-it-fails).

> [!IMPORTANT]
> **Status: a working protocol, live on devnet.** 49 tests pass, most of them against the real mainnet
> binaries of the Solana Attestation Service and Squads, and an independent adversarial review's
> findings are fixed or recorded as trade-offs. Every devnet address is in
> [docs/devnet.md](docs/devnet.md). No external audit yet. This is
> software, not an offer: no token here is for sale, and neither the code nor its documentation
> projects a return. [PROMPT.md](PROMPT.md), the engineering brief, quotes the offering's public
> terms only as context for the engineer.

<p align="center"><img src="assets/flow.svg" alt="Six steps: name a gap, curate, deliver, own it, operate, claim" width="100%"></p>

## The journey

Never touched Solana? Guide 00 first. The rest: ~1 h 30 in total.

| # | Guide | You leave with | Time |
|:-:|---|---|:-:|
| **00** | [New to Solana](docs/guide/00-new-to-solana.md) | accounts, PDAs, tokens, Anchor and the client, each shown in this repo | ~45 min |
| **01** | [Run it locally](docs/guide/01-run-it.md) | the Founder Haus world and the harness on your machine | ~15 min |
| **02** | [The whitelist](docs/guide/02-the-whitelist.md) | a member who can hold the asset, a wallet that cannot, a one-step revocation | ~10 min |
| **03** | [Fund a tranche](docs/guide/03-fund-a-tranche.md) | USDC in, tokens minted in the same transaction, the holding's share alongside | ~10 min |
| **04** | [Work and the council](docs/guide/04-work-and-the-council.md) | a work bounty from gap to settlement, accepted by two of three | ~15 min |
| **05** | [Rent and claims](docs/guide/05-rent-and-claims.md) | rent split pro rata without any list of holders, claimed once | ~10 min |
| **06** | [Going to devnet](docs/guide/06-going-to-devnet.md) | the program on devnet, visible in the explorer | ~30 min |

## What the program guarantees

| | Guarantee | How |
|---|---|---|
| **No token without delivery** | Asset tokens come into existence only from a funded financial bounty or a work bounty the council accepted. | Every mint path goes through `contribute` or `settle_work`; settling anything but an `Accepted` bounty reverts. |
| **Holding is gated, not just buying** | An account can receive or move the asset only after the gate thaws it for a wallet with a live attestation from the whitelist issuer. When the attestation lapses, anyone can freeze the account; the balance stays. | Mints are born frozen (`DefaultAccountState = Frozen`); only `thaw_holder` thaws, and only for attested wallets. The issuer revokes and freezes in one transaction. |
| **Nobody lists the holders** | Rent reaches every profit holder pro rata, with no snapshot, no Merkle root, and no authority stating who owns what. | An on-chain reward index plus a transfer hook that moves each holder's tracked balance with every transfer (burns are not tracked; see D9). Holders pull their share. |
| **No single key decides** | Curation, acceptance, pausing and moving capital need two of three council members. | The council is a Squads v4 vault; one member's key is refused with `NotCouncil`. |

## Examples, one per flow

Every flow is a function in [`clients/ts/src/protocol.ts`](clients/ts/src/protocol.ts) built on the
generated client, and every one is exercised by a test you can read top to bottom.

| Flow | Call | Test |
|---|---|---|
| Join the whitelist (open position, thaw both accounts) | `joinInstructions` | [`gate.test.ts`](tests/gate.test.ts) |
| Revoke and freeze in one transaction | `revokeAndFreezeInstructions` | [`gate.test.ts`](tests/gate.test.ts) |
| Fund a tranche | `contributeInstruction` | [`funding.test.ts`](tests/funding.test.ts) |
| Propose, claim, deliver and settle work | `proposeInstruction`, `claimBountyInstruction`, `settleWorkInstruction` | [`work.test.ts`](tests/work.test.ts) |
| A council action through Squads | `councilAction` → `propose`, `approve`, `execute` | [`council.test.ts`](tests/council.test.ts) |
| Record rent, claim it, move it with a transfer | `recordInflowInstruction`, `claimDistributionInstruction` | [`distribution.test.ts`](tests/distribution.test.ts) |
| The whole path on a real RPC | all of the above | [`e2e/full-flow.test.ts`](tests/e2e/full-flow.test.ts) |

> [!TIP]
> **Want the whole story in one file?** [`tests/e2e/full-flow.test.ts`](tests/e2e/full-flow.test.ts)
> runs gap → bounty → funding → gate → work → rent → claim on Surfpool in about 70 lines.

## Architecture

<p align="center"><img src="assets/architecture.svg" alt="Members, operator, council and issuer act on the Founder Village program, which controls Token-2022 mints and USDC vaults and reads SAS attestations" width="100%"></p>

| Account | Seeds | Holds |
|---|---|---|
| `Asset` | `["asset", creator, asset_id]` | policy numbers from `config/founder-haus.json`, council, holding, pinned SPV treasury, SAS credential and schema, the USDC ledger, the reward index, status |
| Ownership mint | `["mint", asset, 0]` | Token-2022: `DefaultAccountState = Frozen`, `TransferHook` (no program yet), `MetadataPointer` + `TokenMetadata`; mint and freeze authority = asset |
| Profit mint | `["mint", asset, 1]` | same, with the transfer hook pointed at Founder Village |
| Hook account list | `["extra-account-metas", profit_mint]` | asset, plus the sender's and receiver's positions resolved from each token account's owner |
| Capital vault | `["capital", asset]` | USDC from contributions; leaves only to the SPV treasury |
| Income vault | `["income", asset]` | USDC from rent; leaves only as holders' claims |
| `Bounty` | `["bounty", asset, id]` | kind, state, proposer, title, spec hash, terms, raised, claimant, delivery hash |
| `Position` | `["position", asset, owner]` | the owner's profit balance, last index, accrued and claimed income |
| `Receipt` | `["receipt", bounty, contributor, receipt_id]` | one contribution: amount, tokens, time |

The whitelist lives in the **Solana Attestation Service**: one attestation per wallet at
`PDA("attestation", credential, schema, wallet)`, carrying a hash of the off-chain KYC record and
a tier, never the record itself. The program re-derives that address, checks the owner, the pinned
credential and schema, the subject, the expiry, and that the signer is still authorized.

### The bounty state machine

<p align="center"><img src="assets/state-machine.svg" alt="Proposed, Curated, Open; work: Claimed, Delivered, Accepted, Settled or Rejected; financial: Paused and close into Settled; Cancelled without capital" width="100%"></p>

The lifecycle lives in the program, not in a mutable config. Each transition is one instruction. A
call in the wrong state reverts with `InvalidBountyState` (in the wrong kind of bounty, with
`WrongBountyKind`), and the terms cannot change after curation.

### Distributions

<p align="center"><img src="assets/distribution.svg" alt="Reward index rises with each inflow; the transfer hook settles both sides of a transfer; holders claim accrued plus balance times the index rise" width="100%"></p>

A plain transfer into a vault changes no accounting: only `record_inflow` counts as rent, and it is
refused until someone holds profit tokens. Claims round down, pay once, and can never exceed what
was recorded; the part of an inflow the index cannot represent is carried, in index units, into the
next one.

### Who holds which key

| Authority | Localnet demo | Intended for production |
|---|---|---|
| Council (curate, accept, pause, outflow) | Squads v4 vault, 2-of-3 demo members | Squads vault of the core contributors, with a `time_lock` as an enforced notice delay |
| Mint and freeze authority of both mints | the asset PDA | the asset PDA (the program); freeze can move to Token ACL with an upgrade |
| Attestation issuer | a demo key | a Squads vault or a dedicated, rotated issuer |
| Program upgrade authority | none (loaded by Surfpool) | a Squads multisig; immutability is a deliberate later decision |
| SPV treasury (capital destination) | a demo USDC account, pinned at creation | the SPV's account |

### Parity with the EVM prior art

An earlier version of the mechanism runs on EVM chains through Juicebox V6 and Revnet (the
[Homerun](https://github.com/mejango/homerun) repository). Reading that code taught four lessons;
each is a deliberate change here:

| Homerun (EVM) | Founder Village (Solana) |
|---|---|
| Lifecycle is owner-queued configuration; the "phase" is inferred by the app | Every phase change is an instruction with its own signer and its own test |
| A closed campaign lets a client burn its claim for zero | A forbidden action reverts with a named error |
| The owner attests the holder snapshot for the initial allocation | The program tracks every profit balance; nobody attests holders |
| The allowlist gates payment beneficiaries while transfers stay open | Holding is gated: accounts are born frozen and thawed only for attested wallets |
| Two tokens: a fund claim and an income claim | Two tokens: ownership and profit |
| "Notice delay" appears in no code | Squads `time_lock` enforces one (to be set before mainnet; see [DECISIONS](docs/DECISIONS.md) O8) |

## Tests and the gate

```bash
npm run gate             # everything CI runs, in order
docker compose run --rm gate   # the same, in the pinned image
```

The suites load `target/deploy/founder_village.so` and the fetched SAS and Squads binaries, so run
`npm run dev` once (or `npm run build:program && npm run fixtures:programs`) before calling them
one by one:

```bash
npm test                 # 42 tests in LiteSVM, against the mainnet SAS and Squads binaries
npm run test:e2e         # the full path on an embedded Surfpool
cargo test -p founder_village    # 6 unit and property tests of the arithmetic
```

What they prove, among others: a non-whitelisted wallet cannot be thawed or receive the token; an
account whose owner could be reassigned is refused; revocation is enforceable by anyone and keeps the
balance; no mint without an accepted bounty, and a rejected delivery mints nothing; terms cannot
change after curation; one council key cannot curate, accept, pause or move capital, and Squads
refuses to execute below the threshold; the vault always equals contributions minus recorded
outflows; the holding's share holds after mixed issuances; pause, resume, close and deadlines behave;
the hook moves future income with the token and cannot be called outside a transfer; no holder can
claim twice and payouts never exceed recorded income, even across many tiny inflows; income cannot
be recorded before anyone holds; a claimed work bounty that is never delivered can be freed; and a
holder can be revoked and frozen in one transaction. Every rejection asserts its exact error code.

Reviewed by an independent adversarial review; its two medium and one low findings are fixed with
regression tests and its trade-offs recorded ([details](docs/DECISIONS.md#reviews)). CI also runs
`cargo fmt`, `clippy -D warnings`, `anchor build`, the Codama drift check, `tsc` and `npm audit`,
with actions pinned by commit SHA. The proofs behind the property tests, the compute units of all 22
instructions and the full review log are in [docs/ENGINEERING.md](docs/ENGINEERING.md).

## With an AI agent

1. **Hand it the rules.** [`AGENTS.md`](AGENTS.md) is one file: what the system is, the one command,
   every instruction with its signer, the error table with UI copy, and which accounts each screen reads.
2. **One guide per session.** Point it at a guide in [`docs/guide/`](docs/guide/) and ask for that outcome only.
3. **Ask for proof.** A passing `npm run gate` and what the harness shows count; "it compiles" does not.

## What's here

```text
foundervillage/
├── programs/founder_village/      the Anchor program: instructions/, sas.rs, token.rs, math.rs, state.rs
├── clients/ts/src/        the Kit client: generated/ (Codama), protocol.ts, squads.ts, attestations.ts
├── app/                   the test harness
├── scripts/               dev, gate, localnet, seed, world, codama, dump-programs
├── tests/                 LiteSVM suites, and tests/e2e on Surfpool
├── docs/CONTRACTS.md      how the contracts work, for everyone
├── docs/guide/            the seven guides, 00 to 06
├── docs/DECISIONS.md      every design choice, its source, and what is still open
├── docs/ENGINEERING.md    the math and its proofs, compute, toolchain, reviews
├── docs/devnet.md         every devnet address, with explorer links
├── ia/                    context and step-by-step guide for AI agents
├── config/                the policy numbers of each asset
├── idl/                   the Founder Village IDL and the vendored Squads v4 IDL (MIT)
├── Dockerfile · docker-compose.yml   the pinned environment
├── AGENTS.md              the handoff for whoever builds the production frontend
└── PROMPT.md              the engineering brief this was built against
```

## What going live costs

Read live from mainnet on 2026-10-26, at 5,080 lamports per byte. Rent is a refundable bond, not a
fee; it comes back when the account closes.

| Item | Size | Rent |
|---|---|---|
| Program data (current binary) | 575,405 B | 2.92 SOL |
| `Asset` | 477 B | 0.0031 SOL |
| `Bounty` | 303 B | 0.0022 SOL |
| `Position` | 113 B | 0.0012 SOL |
| `Receipt` | 105 B | 0.0012 SOL |

A holder costs about 0.0043 SOL (two token accounts and a position). The line that dwarfs all of
these is a **security audit**, which this program needs before it holds anyone's money.

## Limits, stated plainly

Not built yet: Mollusk compute benchmarks, Trident fuzzing, a verifiable build,
an asset-wide kill switch, and an external audit. Open questions for Founder Village and counsel,
including whether the income stream must be separately transferable and how work bounties are
taxed as compensation, are in [docs/DECISIONS.md](docs/DECISIONS.md).

## Disclaimer

Founder Village is open-source software. It is not an offer or solicitation to buy any security or token,
and nothing here is legal, tax or financial advice. A token confers no title over a property.
Founder Village's offering documents are the only description of any offering.

## License

[Apache-2.0](LICENSE)

---
[00 · New to Solana →](docs/guide/00-new-to-solana.md)
