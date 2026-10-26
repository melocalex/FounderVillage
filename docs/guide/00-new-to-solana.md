# 00 · Never coded on Solana? Start here

**You leave with:** the mental model to read and change this repository without guessing.
**Time:** ~45 min. **You need:** comfort with TypeScript; Rust helps but is not required yet.

Every idea below is shown with the place it lives in Cachain, so you can open the file and see it.

---

## 1. The one idea that changes everything

On most chains a contract holds its own data. **On Solana, programs hold no data.** A program is
executable code; everything it remembers lives in separate **accounts** that are passed to it in
every call.

So "the Cachain contract" is really one program plus many accounts: one per asset, one per bounty,
one per holder position, and so on. When you call an instruction you must hand it every account it
will read or write. That is why our instruction builders take so many accounts, and why we
generate them instead of writing them by hand.

## 2. Accounts

Every account has:

| Field | Meaning |
|---|---|
| address | 32 bytes, shown in base58 (`CachxfgQ…QP6S`) |
| owner | the program allowed to change its data |
| lamports | its SOL balance (1 SOL = 10^9 lamports) |
| data | bytes the owner program defines |

Only the **owner program** may change an account's data or take its lamports. Our `Asset`,
`Bounty`, `Position` and `Receipt` accounts are owned by Cachain; token accounts are owned by the
Token-2022 program; attestations by the Attestation Service.

**Rent** is a refundable deposit: an account must hold a minimum balance for its size (today 5,080
lamports per byte plus a fixed part). Close the account and the deposit comes back. Never hard-code
it; ask the cluster (`getMinimumBalanceForRentExemption`).

## 3. Who may do what: signers

A transaction is signed by keys. An instruction can require that a given account **signed**. In
Anchor that is `Signer<'info>`. Examples in Cachain:

- `contribute` requires the contributor's signature: nobody can spend your USDC for you.
- `curate_bounty` requires the **council** to sign. The council is not a person: it is a Squads
  vault, and Squads only signs for it after two of three members approve.

## 4. PDAs: addresses a program can sign for

A **program-derived address** is computed from a program ID and some **seeds**. It has no private
key, so no person can sign for it, but the program that derived it can, inside its own
instructions. PDAs give us two things:

1. **Predictable addresses**: anyone can compute where an account lives.
2. **Program-held authority**: the asset PDA is the mint and freeze authority of both tokens and
   the owner of both USDC vaults, so only the program's rules can move them.

Cachain's seeds (see `programs/cachain/src/state.rs`):

| Account | Seeds |
|---|---|
| Asset | `"asset"`, creator, asset id |
| Ownership / profit mint | `"mint"`, asset, `0` / `1` |
| Capital / income vault | `"capital"` or `"income"`, asset |
| Bounty | `"bounty"`, asset, bounty id |
| Position | `"position"`, asset, owner |
| Receipt | `"receipt"`, bounty, contributor, receipt id |

In TypeScript the generated client derives most of them for you (`findPositionPda`, …), and
`clients/ts/src/protocol.ts` fills the rest.

## 5. Transactions and instructions

A **transaction** is a list of **instructions**, each naming a program, its accounts (marked
signer and/or writable) and some data. It is atomic: if any instruction fails, nothing happens.
That lets us do things like "revoke an attestation and freeze both accounts" in one go
(`revokeAndFreezeInstructions`).

A transaction also carries a **recent blockhash**, so it expires after about a minute; clients
fetch a fresh one and retry safely. We build **version 1** transactions (newer, larger, with
compute limits in the message). Some wallets only sign older versions; the production frontend
must check `supportedTransactionVersions.has(1)` and fall back.

Errors come back as `Custom(code)`. Ours are 6000+, listed in `AGENTS.md`;
`findCustomError(error)` extracts the code from any client error.

## 6. Tokens

| Concept | In plain words | In Cachain |
|---|---|---|
| **Mint** | the token's definition: decimals, supply, authorities | ownership mint, profit mint, USDC |
| **Token account** | one wallet's balance of one mint | your FHO account, your FHP account |
| **Associated token account (ATA)** | the standard token account address for (wallet, mint, token program) | what `joinInstructions` creates |
| **Decimals / base units** | amounts are integers; 1 USDC = 1,000,000 base units | always `bigint` in TypeScript; format only for display |
| **Freeze** | a frozen account cannot send or receive | the whitelist gate |

There are two token programs: classic **SPL Token** (USDC lives there) and **Token-2022**, which
adds **extensions**. Our asset mints use:

- **DefaultAccountState = Frozen**: every new account starts frozen; our `thaw_holder` unfreezes it
  only for whitelisted wallets.
- **TransferHook**: Token-2022 calls a program on every transfer. The profit mint calls Cachain, so
  the income ledger follows the tokens.
- **MetadataPointer + TokenMetadata**: name and symbol, so wallets display them.

Two traps: an ATA's address depends on the token program, so always pass `TOKEN_2022_PROGRAM_ADDRESS`
for the asset tokens; and a transfer of a hooked token needs extra accounts, which
`getTransferCheckedWithTransferHookInstructionAsync` adds for you.

## 7. Programs calling programs (CPI)

A program can call another inside the same transaction (a cross-program invocation). Cachain calls
Token-2022 to mint, freeze and thaw, signing as the asset PDA. Token-2022 calls Cachain's hook on
every profit-token transfer. Squads calls Cachain when a council action executes. Each callee is
pinned in code, so nobody can swap in a fake program.

## 8. Anchor in ten minutes

Cachain is written with **Anchor**, the standard Rust framework. Open
`programs/cachain/src/instructions/issue.rs` and find `Contribute`:

```rust
#[derive(Accounts)]
pub struct Contribute<'info> {
    #[account(mut)]
    pub contributor: Signer<'info>,                    // must sign
    #[account(mut, has_one = capital_vault, ...)]
    pub asset: Box<Account<'info, Asset>>,             // owned by Cachain, typed, checked
    #[account(mut, has_one = asset, constraint = bounty.kind == BountyKind::Financial ...)]
    pub bounty: Box<Account<'info, Bounty>>,
    ...
}
```

- `#[derive(Accounts)]` lists every account and the **constraints** Anchor checks before your code
  runs: who must sign, which program owns it, which seeds derive it, how it relates to others
  (`has_one`).
- `#[account]` structs (in `state.rs`) are the data layouts, with an 8-byte type tag in front.
- The handler (`pub fn contribute(...)`) holds the business rules: state checks, arithmetic, CPIs.
- `#[error_code]` (in `error.rs`) numbers our errors from 6000.
- `emit_cpi!` records structured events an indexer can read.

The program entry points are listed in `lib.rs`; each delegates to a file in `instructions/`.

## 9. From program to typed client

`anchor build` writes the **IDL** (`idl/cachain.json`), a JSON description of every instruction,
account and error. **Codama** turns it into the TypeScript client in
`clients/ts/src/generated/cachain` (`npm run codama`). Never hand-encode instruction bytes or
decode accounts yourself; if the program changes, rebuild and regenerate, and CI fails if you
forget.

## 10. Signing in apps

The client library is **@solana/kit**. A "client" is built from plugins: a signer, an RPC
endpoint, and a transaction planner. In browsers the signer is the user's **wallet** through Wallet
Standard (`@solana/kit-plugin-wallet`). The demo keys in this repository are derived from a public
seed and only exist for the local harness: a real app never holds a private key.

## 11. Testing locally

| Tool | What it is | Used in |
|---|---|---|
| **LiteSVM** | the Solana runtime inside your test process; milliseconds per test | `tests/*.test.ts` |
| **Surfpool** | a full local cluster with an RPC endpoint and time travel | `tests/e2e`, `npm run dev` |

Both load the real Attestation Service and Squads programs fetched from mainnet
(`npm run fixtures:programs`), so the tests exercise the actual dependencies.

## 12. Clusters

| Cluster | For | SOL |
|---|---|---|
| localnet | development and tests | free and instant |
| devnet | public demos | free from the faucet (rate-limited) |
| testnet | validator testing | free; note the Attestation Service is **not** deployed there |
| mainnet-beta | real money | real |

Explorer: <https://explorer.solana.com> (pick the cluster, or a custom RPC for localnet).

## 13. The checklist that saves days

- [ ] Amounts are `bigint` base units end to end. Format at the edge only.
- [ ] Asset tokens are Token-2022: pass `TOKEN_2022_PROGRAM_ADDRESS` when deriving ATAs. USDC is classic SPL Token.
- [ ] A member must `join` (open position, thaw both accounts) before receiving tokens; otherwise `HolderFrozen` or Token-2022 error 17.
- [ ] Profit-token transfers need the hook's extra accounts: use the helper.
- [ ] Check the wallet supports transaction v1 before asking it to sign.
- [ ] Show the program's error; never pre-decide eligibility in the UI.
- [ ] Never put a private key in a frontend, a log or a commit.
- [ ] After changing the program: `npm run build:program && npm run codama`.

## 14. Glossary

**Lamport** smallest SOL unit · **PDA** program-derived address · **ATA** associated token account ·
**CPI** cross-program invocation · **IDL** interface description · **Extension** optional
Token-2022 feature fixed at mint creation · **Attestation** a signed claim about a wallet from the
Attestation Service · **Multisig / vault** a Squads account that acts only after enough members
approve · **Blockhash** a recent block reference that makes a transaction expire.

---
[01 · Run it locally →](01-run-it.md)
