# Cachain

Working repository for putting Founder Village's real-world assets on Solana.

Founder Village is a closed community of founders in Jurerê Internacional, Florianópolis, that
co-owns the infrastructure it builds. Members name a gap, core contributors curate it, the asset
is broken into named bounties, and members who deliver work or capital receive a claim on that
asset. Each asset has its own token and its own economy. Founder Haus, an operating beach club,
is asset 01 and the template for the rest.

This repository currently holds the written foundations for that build: the agent prompt that
governs how the code gets written, a sourced write-up of the prior EVM implementation, and the
decisions that are still open.

## Contents

| Path | What it is |
|---|---|
| [`prompts/solana-agent.md`](prompts/solana-agent.md) | System prompt for the Solana engineering agent. Sections 0–9 are general practice, section 10 is the quality bar used as acceptance criteria, section 11 is this project. |
| [`docs/prior-art/homerun-fv-mechanism.md`](docs/prior-art/homerun-fv-mechanism.md) | How the deployed EVM implementation (Homerun: Juicebox V6 + Revnet) actually works, every claim carrying a file and line. Its mechanism is superseded here; its traps are not. |
| [`docs/DECISIONS.md`](docs/DECISIONS.md) | One entry per design decision. Seeded with the questions that must be answered before the issuance code is written. |
| [`docs/SOURCES.md`](docs/SOURCES.md) | The facts the prompt relies on, each with where it came from and when it was read. |

## Status

Nothing is implemented yet. The mechanism is documented, the prior art is understood, and six
questions in `docs/DECISIONS.md` block the first instruction. The most important of them: the
public documentation describes one token per asset, while the October deck describes ownership
and profit tokens, and the on-chain flow (mint, payouts, distribution) is not specified anywhere.

## Working rules

- The prompt in `prompts/solana-agent.md` governs code written here. Section 10 is not
  aspirational; it is the merge bar.
- Section 11.6 governs anything user-facing. This is a live private offering under Brazilian and
  Honduran law. Code gets written here; offering language does not.
- No member data, no personal identifiers and no deal-room material in this repository, in any
  form, including test fixtures.
