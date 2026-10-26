# Decisions

One entry per decision. Record the answer, who gave it, the date, and the alternative rejected.
An open entry blocks the code that depends on it; do not resolve one by guessing in an
implementation.

Status values: **open**, **decided**, **superseded**.

---

## D-001 — One token per asset, or two?

**Status:** open · blocks the mint layout and every issuance instruction

`foundervillage.xyz/docs` says each asset has its own token, singular, throughout: "Founder
Village does not run a single village-wide token… The AIA data center has its token. The Founder
Haus has its token." The IslandDAO deck of 22 October 2026 says members "earn that asset's token:
**ownership and profit tokens**" and cites a September 2026 two-token deck. The prior EVM
implementation used exactly that split: one token claiming sale proceeds, another claiming
revenue.

Until this is answered, model the claim behind an interface with one implementation per shape.
Do not hard-code a single mint per asset.

**Decision:**
**Date / source:**

---

## D-002 — Does the asset token really start at zero?

**Status:** open · blocks the issuance curve and any price display

The documentation is emphatic that the token "starts with no value" and that value follows
delivery. The live offering has already placed US$214k against a US$2.4M appraisal in priced
tranches, which is not a zero-value start. The deck carries its author's own note to confirm the
claim before asserting it.

Reconcile the bounty narrative with the tranche pricing: either the bounty token and the tranche
quota are different instruments, or "starts at zero" describes the earlier assets rather than the
Haus.

**Decision:**
**Date / source:**

---

## D-003 — The on-chain flow

**Status:** open · blocks everything

Nothing read so far specifies the Solana flow: who holds mint authority, what signature accepts a
delivered bounty, how rent reaches holders, whether distribution is push or claim, and what is
recorded on-chain versus kept off it. The deck flags this as unconfirmed.

Section 11.4 of the prompt proposes an answer. It is a proposal, not a decision.

**Decision:**
**Date / source:**

---

## D-004 — Whitelist mechanism and its authority

**Status:** open · blocks the token extension set, which cannot be changed after the mint exists

The offering states that only whitelisted accounts may participate, and the deck describes access
unlocked by an NFT wallet whitelist. The proposal is Token ACL (sRFC-37) with a mint born frozen
and freeze authority delegated to a gate program, so that holding, not only buying, is gated.

Required before any mint is created: who may add and remove an address, whether removal must be
possible, and what happens to a holder who loses eligibility.

**Decision:**
**Date / source:**

---

## D-005 — Which chain the bounty tokens settle on

**Status:** open

The deck flags it as unconfirmed. The talk commits the infrastructure to Solana; the earlier
implementation ran on four EVM chains. If any bounty settles off Solana, say so before the
portal is designed.

**Decision:**
**Date / source:**

---

## D-006 — Name and platform identity

**Status:** open

This repository is named Cachain because that is what the work was called when it started. The
name appears in no public source: those use Founder Village for the community, FV Mechanism for
the model, and Founder Forge for the builder-layer asset, whose prototype is public at
`craft-founder-ai.lovable.app`.

Decide what Cachain names — the protocol, the bounty platform, the holding's product, or a
rebrand — before it reaches user-facing copy, on-chain metadata or a public repository name.

**Decision:**
**Date / source:**

---

## D-007 — Tranche deadlines on-chain

**Status:** open

The offering runs to four tranches with dates in February 2029 and February 2031. Decide whether
a missed tranche deadline has an on-chain consequence (contributions pause, refund path opens) or
is handled entirely off-chain. "No on-chain consequence" is a valid answer, but it has to be
written down, because silence here becomes a missing state transition.

**Decision:**
**Date / source:**
