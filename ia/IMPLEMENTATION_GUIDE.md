# Implementation guide: the production frontend

This guide gives the order of work for the member portal. Do one step per session. Each step ends
with a proof. Do not start the next step before the proof passes.

Read [DEVELOPER_CONTEXT.md](DEVELOPER_CONTEXT.md) first.

## Stack

| Part | Package |
|---|---|
| Solana client | `@solana/kit` 8 |
| Wallet | `@solana/kit-plugin-wallet` (Wallet Standard) |
| React bindings | `@solana/react` 8 |
| Program client | `clients/ts/src` (import it; do not copy the generated code) |
| Token-2022 helpers | `@solana-program/token-2022` |

Do not use `@solana/web3.js` 1.x, `@solana/wallet-adapter-*`, `@coral-xyz/anchor` or Gill.

## Before step 1

Start the local network:

```bash
npm install --ignore-scripts
npm run dev
```

Open <http://localhost:5183>. The harness shows every flow. Your screens must produce the same
transactions. `app/src/App.tsx` and `app/src/harness.ts` show the calls.

## Step 1: connect a wallet

Create one client for the app with `walletSigner({ chain })` and `solanaRpc({ rpcUrl, transactionConfig: { version: 1 } })`.

Before the first signature, check `connected.supportedTransactionVersions.has(1)`. If the wallet
does not support version 1, create a second client with `transactionConfig: { version: 0 }`.

**Proof:** the app shows the wallet address and the cluster. It refuses to sign when the wallet
supports neither version.

## Step 2: member status

Read `holderAccounts(asset, wallet)`, then `fetchMaybeAttestation`, `fetchMaybeToken` for both token
accounts and `fetchMaybePosition`.

Show: on the whitelist or not, the expiry, each token account (none, frozen or active) and its balance.

**Proof:** Ana shows "on the whitelist" and "active". Eve shows "not on the whitelist".

## Step 3: join

Send `joinInstructions(rpc, asset, wallet, wallet)`. It sends only the missing steps.

**Proof:** a whitelisted wallet becomes active. Eve gets error 6016, and the UI shows the AGENTS.md message for 6016.

## Step 4: bounties

List bounties with ids `0` to `asset.nextBountyId − 1` and `fetchAllBounty`. Show the kind, the
state, the title, the terms and, for a tranche, `raised / target`.

**Proof:** the list matches the harness.

## Step 5: fund a tranche

Send `contributeInstruction(asset, bounty, wallet, amount, receiptId)`. Use a unique `receiptId`
for each contribution of the same wallet.

**Proof:** the balances rise by `amount × price_num / price_den`. Amounts above the target give
error 6028. A paused tranche gives error 6021.

## Step 6: work bounties

Propose with `proposeInstruction`. Claim with `claimBountyInstruction`. Deliver with
`getSubmitDeliveryInstructionAsync` and a SHA-256 hash of the delivery. Settle with
`settleWorkInstruction` after the council accepts.

**Proof:** the full work path passes on localnet. A wallet that did not claim the bounty gets error 6032 on delivery.

## Step 7: council inbox

For council members only. Build the inner instruction with `council: createNoopSigner(vault)`.
Call `councilAction(rpc, multisig, [instruction], member)`. Send `propose`, then `approve` from a
second member, then `execute`. Read the Squads proposal with `squadsClient.fetchProposal` to show
the approvals.

**Proof:** one approval cannot execute (Squads error 6008). Two approvals execute.

## Step 8: rent

Show the claimable rent with the formula in DEVELOPER_CONTEXT.md, section 6. Send
`claimDistributionInstruction(asset, wallet)`.

**Proof:** the USDC balance rises by the claimable amount. A second claim gives error 6034.

## Step 9: devnet

Point the app to devnet with the addresses in `docs/devnet.md`. Get test tokens as
DEVELOPER_CONTEXT.md, section 8, explains.

**Proof:** steps 2 to 8 pass on devnet with a real wallet. Each transaction has an explorer link.

## What to report after each step

1. What you changed, with file paths.
2. The proof: what the screen showed, and the transaction signature or the error code.
3. What you did not do, and why.
