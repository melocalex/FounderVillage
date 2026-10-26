# Engineering notes

This file is for the reviewer who reads the code before the README. It states the arithmetic and
its proofs, the threat model of each gate, the measured cost of every instruction, the pinned
toolchain and the review history. Every number here is measured or derived from the code. The
last section gives the commands that reproduce them.

For the plain-language version, read [CONTRACTS.md](CONTRACTS.md). For each design choice and the
alternative it rejected, read [DECISIONS.md](DECISIONS.md).

---

## 1. Toolchain

Every version is exact. Nothing floats on a caret range in the program or the build image.

| Layer | Component | Version | Pinned in |
|---|---|---|---|
| Program | Anchor (`anchor-lang`, `anchor-spl`, `solana-v3` crates) | `=1.2.1` | `programs/founder_village/Cargo.toml` |
| Program | Solana CLI / platform tools | 4.1.2 / v1.54 | `Anchor.toml` `[toolchain]` |
| Program | Rust | MSRV 1.89; host 1.99.1; SBF code compiled by the platform tools | `Cargo.toml` `rust-version` |
| Program | `spl-transfer-hook-interface` / `spl-tlv-account-resolution` | 2.1 / 0.11 (exact in `Cargo.lock`) | `Cargo.toml` |
| On-chain deps | Token-2022 | `TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb` | program ID |
| On-chain deps | Solana Attestation Service | `22zoJMtdu4tQc2PzL74ZUT7FrwgB1Udec8DdW4yw4BdG` | program ID |
| On-chain deps | Squads v4 | `SQDS4ep65T869zMMBKyuUq6aD6EgTu8psMjkvj52pCf` | program ID |
| Client | `@solana/kit` | 8.5.0 | `package-lock.json` |
| Client | Codama `nodes-from-anchor` / `renderers-js` | 1.5.6 / 2.8.0 | `package-lock.json` |
| Client | `@solana/attestation` | 2.1.0 | `package-lock.json` |
| Tests | LiteSVM / `@solana/kit-plugin-litesvm` | 1.6.1 / 0.22.0 | `package-lock.json` |
| Tests | Surfpool (embedded) | 1.6.1 | `package-lock.json` |
| Tests | Vitest / TypeScript | 5.0.5 / 7.0.2 | `package-lock.json` |
| Runtime | Node.js | ≥ 22.12 (image: 22.12.0) | `package.json`, `Dockerfile` |

Transactions are version 1 (SIMD-0385) everywhere: tests, scripts and the harness.

## 2. Build profile and static guarantees

```toml
[profile.release]
overflow-checks = true   # an unchecked +, -, * panics instead of wrapping, in the deployed binary
lto = "fat"
codegen-units = 1
```

- `#![deny(unsafe_code)]` at the crate root. The program has no `unsafe` block.
- Every arithmetic operation on balances and indices uses `checked_*` and maps failure to
  `MathOverflow` (6038). `overflow-checks` is the second line of defense, not the first.
- `cargo fmt --check` and `cargo clippy --all-targets --locked -- -D warnings` gate every change.
- `cargo test --locked`: the lockfile is the dependency graph. CI never resolves a new version.
- The current build is 575,456 bytes, SHA-256
  `7464963cbc244dc5e92d1e7bced332d283e589ce59d56e25245b852f50c17cea`. Devnet still runs the build
  from before the rename to Founder Village (575,360 bytes): same instructions, accounts, seeds and
  error codes; only the crate name differs. This is not yet a verifiable build (see §11).

## 3. Account model

One program serves every asset. Every account is a PDA of the Founder Village program, so no client can
substitute an account the program did not derive.

| Account | Seeds | Size (bytes) | Rent-exempt deposit |
|---|---|---|---|
| `Asset` | `"asset"`, creator, `asset_id: u64` | 477 | 0.0030734 SOL |
| `Bounty` | `"bounty"`, asset, `id: u64` | 303 | 0.0021895 SOL |
| `Position` | `"position"`, asset, owner | 113 | 0.0012243 SOL |
| `Receipt` | `"receipt"`, bounty, contributor, `receipt_id: u64` | 105 | 0.0011836 SOL |
| Ownership mint | `"mint"`, asset, `0` | 416 | 0.0027635 SOL |
| Profit mint | `"mint"`, asset, `1` | 413 | 0.0027483 SOL |
| Capital / income vault | `"capital"` / `"income"`, asset | SPL token account | |
| Extra account metas | `"extra-account-metas"`, mint | TLV | |

Sizes are read from the live devnet accounts (`getProgramAccounts`, grouped by discriminator).
Deposits are devnet's current rate: $(\text{size} + 128) \times 5080$ lamports.
Both mints carry `DefaultAccountState(Frozen)`, `TransferHook` and `MetadataPointer` with
in-mint `TokenMetadata`. The asset PDA is mint authority and freeze authority of both.

## 4. The arithmetic

All amounts are unsigned integers in base units. USDC and both asset tokens have 6 decimals.
Every function in `math.rs` rounds toward zero. The remainder of every division stays with the
protocol, never with a member. Notation: $\lfloor\cdot\rfloor$ is integer division,
$S = 10^{12}$ is `INDEX_SCALE`, $\beta$ is `holding_bps`.

### 4.1 Issuance

A contribution of $a$ USDC base units at price $p/q$ tokens per USDC mints

$$t = \left\lfloor \frac{a\,p}{q} \right\rfloor .$$

The holding must end with the fraction $\beta / 10^4$ of every issuance. Solving
$\frac{h}{m+h} = \frac{\beta}{10^4}$ for the holding's mint $h$ next to a member mint $m$ gives

$$h = \left\lfloor \frac{m\,\beta}{10^4 - \beta} \right\rfloor , \qquad 0 \le \beta < 10^4 .$$

At $\beta = 2000$ (20 %), $h = \lfloor m/4 \rfloor$: a member mint of 800 adds 200 for the holding,
which is 20 % of 1000.

**Bound.** Let $h^\* = m\beta/(10^4-\beta)$ be the exact share. Then
$\beta(m+h) - 10^4 h = (10^4-\beta)(h^\* - h) \in [0,\,10^4-\beta)$. So the holding never exceeds
its fraction, and it misses it by less than one base unit ($10^{-6}$ token). The property test
`holding_ratio_holds` asserts $0 \le \beta(m+h) - 10^4 h < 10^4$ over
$m \in [0, (2^{64}-1)/10^4]$, $\beta \in [0, 9999)$.

### 4.2 Rent distribution: a reward-index accumulator with carry

Rent is pulled, not pushed. No instruction iterates over holders, so the cost of an inflow is
$O(1)$ in the number of holders.

For inflow $k$ of $A_k$ USDC base units, with $N_k > 0$ tracked profit tokens and a carry
$c_k$ ($c_0 = 0$), `spread` computes

$$\Delta_k = \left\lfloor \frac{A_k S + c_k}{N_k} \right\rfloor ,
\qquad c_{k+1} = (A_k S + c_k) \bmod N_k ,$$

and the index moves $I \leftarrow I + \Delta_k$. By construction

$$A_k S + c_k = \Delta_k N_k + c_{k+1}, \qquad 0 \le c_{k+1} < N_k . \tag{1}$$

The carry is kept in index units (USDC $\times 10^{12}$), which do not depend on $N$. So (1) stays
exact when the supply changes between two inflows. A position with balance $b$ and index snapshot
$I_0$ settles to

$$\text{accrued} \mathrel{+}= \left\lfloor \frac{b\,(I - I_0)}{S} \right\rfloor ,
\qquad I_0 \leftarrow I ,$$

and a claim pays `accrued` once.

**Theorem (no over-promise).** For any sequence of inflows, mints and transfers, the total
claimable by all holders never exceeds $\sum_k A_k$.

*Proof.* Tracked supply equals the sum of position balances at every inflow: mints credit a
position and raise $N$ together, the transfer hook moves balance between positions, and a burn
changes neither (D9). Floors only remove value, so holder $j$ can claim at most
$\sum_k b_{j,k}\Delta_k / S$. Summing over holders and using $\sum_j b_{j,k} = N_k$ and (1):

$$\sum_j \text{claimable}_j \;\le\; \frac{1}{S}\sum_k N_k \Delta_k
\;=\; \frac{1}{S}\sum_k \left(A_k S + c_k - c_{k+1}\right)
\;=\; \sum_k A_k - \frac{c_n}{S} \;\le\; \sum_k A_k .$$

The sum telescopes because $c_0 = 0$. $\blacksquare$

**What is not paid, and where it goes.** The gap between inflows and claims has two parts:

| Part | Size | Fate |
|---|---|---|
| Carry $c_n / S$ | $< N/10^{12}$ base units | carried into the next inflow, never lost |
| Per-holder floor | $< 1$ base unit ($10^{-6}$ USDC) per settlement | stays in the income vault |

At $N = 10^{15}$ (one billion tokens) the carry is below $10^{3}$ base units: 0.001 USDC.

**Why a carry at all (finding F1).** The first version carried the remainder in whole USDC units,
outside the index. Ten inflows of 1 base unit over balances of $10^{10}$, $5\cdot 10^{9}$ and
$3.75\cdot 10^{9}$ promised 18 base units against 10 recorded. The regression test
`tiny_inflows_promise_no_more_than_recorded` keeps that exact sequence.

**Zero supply (finding F2).** With $N = 0$ there is no one to credit, and carrying the inflow
forward would hand it to the first minter. `record_inflow` refuses with `NoHolders` (6041).

### 4.3 Transfers do not move past income

The profit mint's transfer hook (`execute`) runs inside every Token-2022 transfer. For a transfer
of $x$ from $s$ to $d$ at index $I$:

1. settle $s$ and $d$ at $I$;
2. $b_s \leftarrow b_s - x$, $b_d \leftarrow b_d + x$.

Income accrued before $I$ stays with the sender. Income after $I$ follows the new balances.
$\sum b$ is unchanged, so $N$ is unchanged and the theorem in §4.2 still holds. A transfer
between two accounts of one owner touches one position and returns early.

### 4.4 Overflow analysis

All intermediate products are `u128` ($2^{128} \approx 3.40 \times 10^{38}$).

| Expression | Worst case | Fits? |
|---|---|---|
| $a\,p$ in `tokens_for` | $(2^{64}-1)^2 < 2^{128}$ | always; the cast back to `u64` is checked |
| $m\,\beta$ in `holding_share` | $(2^{64}-1)(10^4-1)$ | always; the cast back is checked |
| $A_k S + c_k$ in `spread` | $1.85 \times 10^{31} + 2^{64}$ | always |
| Index $I$ | $\le S \sum_k A_k$ (as $N_k \ge 1$) | overflows only after $3.4 \times 10^{20}$ USDC of rent |
| $b\,(I - I_0)$ in `accrued` | $\le \sum_k N_k \Delta_k \le S \sum_k A_k$ (as $b \le N_k$) | same bound as the index |

The last row is the important one. A naive bound is $2^{64} \cdot I$, which can overflow. But
a balance never exceeds the tracked supply. So the product is bounded by total rent times $S$, the
same bound as the index itself. For scale, the whole USDC supply is of order $10^{11}$ USDC.

### 4.5 Property tests

`proptest`, 256 cases per property by default, in `programs/founder_village/src/math.rs`:

| Property | Domain | Asserts |
|---|---|---|
| `holding_ratio_holds` | $m \le (2^{64}-1)/10^4$, $\beta < 9999$ | the §4.1 bound |
| `distribution_never_exceeds_inflows` | 1–20 balances $< 10^{12}$, 1–40 inflows $< 10^{12}$ | identity (1) at every step, $c < N$, total paid $\le \sum A$ |
| `accrual_is_not_inflated_by_splitting` | $b < 10^{12}$, two index steps $< 10^{18}$ | settling in two steps never pays more than in one |

## 5. The whitelist gate

**Goal.** Only a wallet with a live attestation from the asset's credential can hold either
token. The UI never decides this. The program does.

**Mechanism.** Both mints use `DefaultAccountState(Frozen)`, so every new token account is born
frozen. The asset PDA holds the freeze authority. `thaw_holder` thaws one account if its owner is
eligible. `freeze_holder` re-freezes it when the owner is not, and anyone may call it.

**Attestation check** (`sas.rs`, parsed by hand, no SAS crate in the program). In order:

1. The attestation address equals `PDA(SAS, ["attestation", credential, schema, holder])` (6009).
2. The credential is the asset's credential and SAS owns it (6012, 6010).
3. An empty account at that address is a closed attestation: **Revoked**.
4. SAS owns the attestation, and its discriminator is 2 (6010, 6011).
5. Its subject, credential and schema match the holder and the asset (6014, 6012, 6013).
6. `expiry ≠ 0 ∧ expiry ≤ now` gives **Expired** (6015).
7. Its signer is still in the credential's `authorized_signers`. Removing a signer from a
   credential does not close what it signed, so this is checked here: **SignerRemoved**.

**The bypass we closed (D7).** A thawed token account with a mutable owner could be handed to a
non-whitelisted wallet with `SetAuthority(AccountOwner)`. The account stays thawed, so the gate
would be bypassed. `thaw_holder` now refuses any account without the `ImmutableOwner` extension
(6040). Every associated token account has it.

**Trade-offs recorded, not hidden.** The gate acts at thaw and freeze, not on every transfer
(D26), and reads presence, issuer and expiry, not the attestation's data (D27).

## 6. The transfer hook

- **Cannot be faked.** Token-2022 sets `TransferHookAccount.transferring` on the source and
  destination only during a real transfer. `execute` requires the flag on both (6039). A direct
  call cannot move a position.
- **Account resolution on-chain.** The extra-account-metas list resolves index 5 to the asset
  and the two positions from seeds `["position", asset, owner]`. Each owner is read from bytes
  32..64 of the source (index 0) and destination (index 2) token accounts. A client cannot
  substitute a position.
- **Discriminator.** `execute` carries the SPL interface discriminator
  (`ExecuteInstruction::SPL_DISCRIMINATOR_SLICE`), not Anchor's, so Token-2022 can call it.
- **Same-owner aliasing.** When source and destination owners are equal, both positions are the
  same account (`dup`), and the hook returns before it writes.

## 7. The council

The council is a Squads v4 multisig, 2-of-3. Its vault PDA is the only key that can curate,
accept, reject, pause, resume, close or cancel a bounty, or send capital out. Capital has one exit:
the SPV treasury account pinned at asset creation (6036), never more than recorded (6035).

The Squads `transaction_message` is the one structure we encode by hand
(`clients/ts/src/squads.ts`), because the Squads IDL describes it only as bytes. It uses the
`SmallVec<u8, _>` and `SmallVec<u16, _>` length prefixes of the Squads source. Tests run it
against the mainnet Squads binary, so a wrong byte fails execution.

## 8. Compute budget

Every successful Founder Village invocation in the 42 integration tests, parsed from the runtime logs
(`Program … consumed N of …`). It includes the CPIs each instruction makes.

| Instruction | Samples | Median CU | Max CU | Devnet median |
|---|---:|---:|---:|---:|
| `create_asset` | 7 | 30,257 | 30,257 | 28,753 |
| `create_mints` | 7 | 62,967 | 62,967 | 85,185 |
| `open_position` | 15 | 15,307 | 16,807 | 10,807 |
| `thaw_holder` | 34 | 13,900 | 16,900 | 14,335 |
| `freeze_holder` | 8 | 15,572 | 16,261 | |
| `propose_bounty` | 10 | 16,836 | 22,794 | 19,835 |
| `curate_bounty` | 9 | 7,359 | 7,552 | 7,359 |
| `open_bounty` | 8 | 6,707 | 6,724 | 6,707 |
| `pause_bounty` / `resume_bounty` | 1 / 1 | 6,709 / 6,707 | | |
| `close_funding` | 1 | 6,727 | | |
| `cancel_bounty` | 1 | 6,725 | | |
| `contribute` | 10 | 61,024 | 61,194 | 62,723 |
| `claim_bounty` | 3 | 13,318 | 13,340 | |
| `submit_delivery` | 2 | 6,002 | 6,002 | |
| `accept_delivery` / `reject_delivery` | 1 / 1 | 6,684 / 6,703 | | |
| `settle_work` | 1 | 49,110 | | |
| `record_inflow` | 13 | 12,168 | 12,422 | 12,421 |
| `record_outflow` | 1 | 11,787 | | |
| `claim_distribution` | 5 | 19,698 | 22,698 | |
| `execute` (transfer hook) | 1 | 14,360 | | |

The heaviest instruction, `contribute`, makes four Token-2022 mints (both tokens, to the member and
to the holding), one USDC `transfer_checked` and a receipt. It uses at most 61,194 CU: 31 % of the
default 200,000 per instruction, and 4.4 % of the 1,400,000 per transaction. No instruction needs a
compute-budget request. The devnet column is the same measurement on the real devnet transactions
of `npm run devnet:seed`.

## 9. Tests

| Layer | Count | Runs against |
|---|---:|---|
| Rust unit and property tests (`math.rs`) | 6 | pure functions |
| Integration (`tests/*.test.ts`) | 42 | LiteSVM with the real Token-2022 and the **mainnet binaries** of SAS and Squads, dumped read-only |
| End to end (`tests/e2e`) | 1 | embedded Surfpool: the full Founder Haus scenario over RPC |
| Bootstrap | 1 | `dev.ts --seed-only`: the one-command demo seeds from zero |

Error tests assert the exact custom code (`expectCode`), not "it failed". Only failures raised by
the runtime itself are matched by message. Each review finding has a regression test.

`scripts/gate.sh` runs, in order: rustfmt, clippy `-D warnings`, the Rust tests, `anchor build`,
the generated-client drift check, typecheck, the binary fetch, the integration tests, the end-to-end
test and the bootstrap. CI runs the same steps in two jobs: `program` (fmt, clippy, Rust tests,
build) hands the binary and IDL to `client` (drift check, typecheck, audit, tests, bootstrap).
Docker runs the same script in a `linux/amd64` image.

**Generated-client drift.** CI regenerates the Codama client from the IDL and fails on any diff.
A hand edit of generated code, or an IDL change without regeneration, cannot merge. The formatter
config is part of the repository (`.prettierrc`), so the output is the same on every machine.

## 10. Supply chain

- GitHub Actions pinned by commit SHA, not tag.
- The Docker image checks a SHA-256 for each download: rustup 1.29.1, the Solana release, Anchor
  1.2.1 and Node 22.12.0. `curl --retry` handles transient TLS errors without loosening the check.
- `npm ci --ignore-scripts`: no dependency runs an install script.
- `npm audit --audit-level=high` gates CI. The current result is 0 vulnerabilities.
- `cargo … --locked` everywhere.
- The SAS and Squads binaries come from mainnet through a read-only RPC. Their SHA-256 is printed
  on every fetch.
- The Squads IDL is vendored, with its MIT licence, and does not come from an npm package.

## 11. Review history

| When | Review | Result |
|---|---|---|
| 2026-10-26 | Own review of the gate | D7: thaw requires `ImmutableOwner`. It closed an owner-swap bypass. |
| 2026-10-26 | Independent adversarial review: entry-point table, six scanner patterns, manual walk, LiteSVM reproductions against real binaries | **F1** (medium): carry over-promise, fixed (§4.2). **F2** (medium): zero-supply inflow, fixed with `NoHolders`. **F3** (low): a claimant could hold a work bounty forever, fixed by allowing the council to cancel it (D25). Three trade-offs recorded: D9, D26, D27. |
| 2026-10-26 | `program_autofixer` over every program file | no findings. Its high-severity coverage is thin, so we do not count it as a review. |

**Not done yet.** No external audit. No verifiable build. No Trident fuzzing. No Mollusk
benchmarks: §8 uses LiteSVM logs. The devnet upgrade authority is a single wallet. Each item is a
precondition for real money, and DECISIONS.md lists the open questions.

## 12. How decisions are made

Each decision in [DECISIONS.md](DECISIONS.md) records three things: the choice, its source and the
alternative it rejected. The sources have a fixed precedence: the product owner in the build
conversation, then the asset page, the Founder Village docs, the IslandDAO deck, and the prior EVM
implementation as prior art only. There are 27 answered decisions (D1–D27) and 8 open questions
(O1–O8) for Founder Village and counsel. When a review finding changes a rule, the decision cites
the finding.

## 13. Reproduce

```bash
cargo test --locked -p founder_village                  # §4.5 properties
npm run gate                                    # §9, every step
docker compose run --rm gate                    # §9 in linux/amd64
npm run devnet:seed                             # §3 sizes, §8 devnet column
```

§8 comes from the integration suite with a log recorder on `LiteSVM.prototype.sendTransaction`.
The devnet column comes from `getTransaction` logs of the program's devnet signatures.
