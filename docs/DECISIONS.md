# Decisions

Every design choice, where it came from, and what was rejected. Dates are when the choice was made.
"Open" items need an answer from Founder Village (and, where noted, counsel) before anything is
deployed with real money.

Sources, in order of precedence: Alex in the build conversation; the asset page
`foundervillage.xyz/assets/founder-haus`; `foundervillage.xyz/docs`; the 22 Oct 2026 IslandDAO deck
"Tokenizing a Neighborhood"; the Homerun EVM implementation (prior art only).

## Answered

| # | Decision | Source, date | Alternative rejected, and why |
|---|---|---|---|
| D1 | **Cachain names the protocol**: the open-source programs and client that run the FV Mechanism. Founder Village and Founder Haus stay the community and asset names. | Alex, 2026-10-26 | Bounty-platform name; rebrand of Founder Village. |
| D2 | **Public repository** under `melocalex/cachain`. No deal-room material, no member data, no return figures in any file. | Alex, 2026-10-26 | Private. |
| D3 | **Two tokens per asset: ownership and profit**, minted 1:1 on every issuance. | Deck slide 14 ("ownership and profit tokens"), PROMPT §11.4 | One token claiming everything: a holder would have to sell ownership to realise income. One token plus a USDC ledger: kept as the fallback in O1. |
| D4 | **Both issuance paths in one program.** Priced tranches are financial bounties (Founder Haus); assets that start from nothing are built by work bounties. | Asset page (priced tranches); `/docs` ("starts with no value") | Treating the two as one contradiction to resolve. |
| D5 | **Eligibility is a Solana Attestation Service attestation**, read and parsed by the program: pinned credential and schema, the holder's wallet as nonce, expiry, and a signer the credential still authorizes. | PROMPT §11.4 | A raw address list; an NFT whitelist (deck): neither expires nor carries an issuer. |
| D6 | **The asset PDA keeps the freeze authority and is the gate.** `thaw_holder` thaws attested holders; `freeze_holder` lets anyone re-freeze a revoked or expired one. | Token ACL research, 2026-10-26 | **Token ACL (sRFC-37)** now: deployed and audited, but it thaws once and has no re-freeze without a second gate program and a crank, and code changed after its audit. The irreversible part, `DefaultAccountState = Frozen` with a freeze authority set, is already right, so moving the freeze authority to a Token ACL `MintConfig` later is a program upgrade, not a new mint. **MPL-3643**: alpha, unaudited, no published program IDs. |
| D7 | **The gate thaws only accounts with `ImmutableOwner`** (every associated token account has it). | Own review, 2026-10-26 | Thawing any token account: a thawed plain account could be handed to a non-whitelisted wallet with `SetAuthority`. Fixed before release. |
| D8 | **Distribution is an on-chain accumulator.** `record_inflow` raises a reward index; the profit mint's transfer hook settles both sides of every transfer; holders pull with `claim_distribution`. | PROMPT §11.4, §11.5 lesson 3 | A Merkle root posted by the council (the council would state who the holders are); periodic snapshots (balances between snapshots are unknowable on-chain). |
| D9 | **Burned profit tokens keep their income share with the burner.** Burns skip the hook, so the tracked supply counts every token minted. Nobody else's share shrinks. **Any future redemption must not be "holder burns tokens"**: it would pay the burner twice. | Own analysis; independent review F5 | Blocking burns (Token-2022 has no extension for it). |
| D10 | **Claims require a live attestation.** A frozen holder keeps accruing and claims after reinstatement. Nothing is confiscated. | PROMPT §11.4 ("what losing eligibility does") | Paying ineligible holders (sanctions); dropping their accrual. |
| D11 | **The holding's share is a split on each issuance**, `holding_bps` in the config (2,000 = 20%), rounded down so members are never shorted; a test asserts the ratio after mixed issuances. | Deck slide 16 ("keeps 20% of every tokenized asset") | Pre-minting at genesis: assets that start from nothing have no supply to pre-mint against. |
| D12 | **Tranches are financial bounties.** Target, price and deadline are written once at curation. After a deadline contributions revert (`DeadlinePassed`). There are **no on-chain refunds**: a shortfall against a target is handled off-chain. Tranche 2 has no deadline because none is published. | Asset page (tranche schedule) | A deadline with an automatic on-chain consequence (refund or cancel): needs a decision from counsel first. |
| D13 | **The council is a Squads v4 multisig vault.** Curation, opening, pausing, closing, acceptance, rejection and outflows need it. Membership changes happen inside Squads, so the vault address, and the program, never change. | PROMPT §11.4 | A single admin key; an in-program council. |
| D14 | **Every transition is its own instruction**; work settlement is permissionless because amount and recipient are already fixed. | PROMPT §10, §11.5 lesson 1 | Status flags in mutable config (Homerun). |
| D15 | **Mint extensions:** `DefaultAccountState = Frozen`, `TransferHook` (profit mint points at Cachain; ownership mint keeps the extension with no program so per-transfer rules can be added), `MetadataPointer` + `TokenMetadata`. **Not enabled:** `PermanentDelegate`, `MintCloseAuthority`, `TransferFee`. | PROMPT §11.4 | A permanent delegate for court orders: irreversible, so it is a question for counsel before a mainnet mint (O5). |
| D16 | **Capital leaves only to the SPE treasury account pinned at creation**, never more than recorded (`ExceedsCapital`). Stray transfers into a vault change no accounting. | PROMPT §11.4 | Outflow to any destination the council names. |
| D17 | **Transaction v1 everywhere** (Kit 8.5 plugin clients). The harness refuses wallets that cannot sign v1; the production frontend must keep a `version: 0` client for them. | PROMPT §5 | v0 by default. |
| D18 | **Anchor 1.2.1 on the `solana-v3` crates**, Solana CLI 4.1.2. No Pinocchio: nothing measured asks for it. | Compatibility matrix | Anchor 2.0 RC (alpha); Pinocchio without a CU reason. |
| D19 | **The local demo runs on an offline Surfpool** with the mainnet SAS and Squads binaries fetched read-only. | Determinism | A live mainnet fork: depends on the network and changes under you. |
| D20 | **Contribution token on localnet is a local stand-in for USDC.** The mint is configuration; on mainnet it is USDC. | PROMPT §13.2 | Hunting for a devnet USDC faucet. |
| D21 | **Asset address = PDA(`asset`, creator, asset id).** Anyone can create an asset; nobody can squat someone else's. | Own design | Global ids (squattable). |
| D22 | **The distribution remainder is carried in index units** (`amount × 10^12 + carry = step × supply + new carry`), so no inflow promises more than it brought and nothing is stranded except per-holder rounding dust. | Independent review F1, 2026-10-26 | Carrying the remainder in whole USDC units (overpromised when inflows were tiny; found in review and fixed before release). |
| D23 | **`record_inflow` is refused while nobody holds profit tokens** (`NoHolders`). | Independent review F2 | Carrying zero-supply income into the next inflow: the first minter would collect all of it. |
| D24 | **Income is assigned when it is recorded, not time-weighted.** Someone who contributes just before a rent payment shares in it, as a share bought before a dividend date does; they paid the curated price for the tokens. | Independent review F2 | Time-weighted accrual (needs per-holder history the program does not keep). |
| D25 | **The council can cancel a claimed work bounty**, so a claimant who never delivers cannot hold it forever. An accepted bounty waits for its claimant to be eligible again. | Independent review F3 | No exit from `Claimed`. |
| D26 | **Eligibility is enforced at thaw and freeze, not on every transfer.** A revoked holder can move tokens to another eligible holder until someone freezes them, so revocation should always use `revokeAndFreezeInstructions` (revoke and freeze in one transaction), and a keeper can freeze any lapsed holder. The holding's own attestation must not expire, or anyone could freeze it and halt issuance. | PROMPT §11.4 ("transfers stay standard"); independent review F4 | Checking the receiver's attestation inside the profit hook (possible later; the ownership mint has no hook program). |
| D27 | **The gate reads presence, issuer and expiry, not the attestation's contents.** The tier and the schema's pause flag do not gate. | Independent review F6 | Gating on tier: needs Founder Village to define tiers first. |

## Open

| # | Question | Why it matters | Default until answered |
|---|---|---|---|
| O1 | Must the income stream be transferable or borrowable separately from ownership? | Yes keeps the profit mint. No means one ownership token plus the USDC ledger is enough, and narrows the securities surface. The choice is irreversible once a mainnet mint exists. | Two tokens (D3). |
| O2 | Price per token in each tranche. | `price_num / price_den` is fixed at curation. | 1 token per USDC, a placeholder in `config/founder-haus.json`. |
| O3 | Work bounties pay a service provider in the asset's own token. Employee or contractor, which country, the token's value at vesting for income tax, payroll obligations, and whether paying a non-member widens the private offer. | PROMPT §11.6. A work-bounty payout is compensation, not a subscription. | Runs only on localnet. **Do not settle a work bounty on mainnet before counsel answers.** |
| O4 | What happens on-chain at a tranche deadline beyond refusing contributions? | D12 records "no consequence on-chain". | Off-chain. |
| O5 | Must a court order be executable on-chain (forced transfer)? | Only a `PermanentDelegate` can do it, and it can never be removed. | Not enabled. |
| O6 | Is the NFT whitelist in the deck current, and does it replace or sit beside SAS attestations? | The program gates on SAS only. | SAS only. |
| O7 | Who issues attestations in production, and from which key? | The credential's authorized signers decide who is eligible. | A demo issuer key; production should be a Squads vault or a dedicated, rotated issuer. |
| O8 | A notice delay on council actions. | Homerun's "notice delay" existed in no code. Squads `time_lock` enforces one. | 0 on localnet. Set a real `time_lock` before devnet demos. |

## Reviews

- `program_autofixer` (Solana MCP) over every program file: no issues at any severity. The tool's
  coverage of critical/high patterns is thin, so this is not counted as a review.
- An independent adversarial review (entry-point table, the six scanner patterns, a manual walk,
  LiteSVM reproductions against the real Token-2022 and SAS binaries) on 2026-10-26 found two
  medium issues (F1, F2) and one low (F3), fixed with regression tests, and three trade-offs now
  recorded as D9, D26 and D27.

## Not built yet (gaps, stated plainly)

- **Devnet deployment** with explorer links. Needs a funded deploy wallet the user keeps and approves.
- **Mollusk CU benchmarks** with a committed baseline, and **Trident fuzzing** of the bounty and distribution state machines.
- **Verified build** (`anchor build --verifiable`, OtterSec registry) and the IDL published through Program Metadata.
- **A global kill switch.** The council can pause any tranche, but there is no asset-wide pause.
- **An external audit.** This program will hold other people's money; it should not touch mainnet without one.
