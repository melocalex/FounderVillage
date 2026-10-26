# Sources

Everything the prompt and the decisions rest on, with where it came from and when it was read.
Re-read before trusting a number: the offering is live and these move.

All three sources below were read on **2026-10-26**.

---

## 1. `foundervillage.xyz/docs` — the mechanism

The canonical statement of how assets are created. Labelled an educational overview that directs
the reader to the asset-specific legal documents before deciding anything.

- Closed, curated community. "Not a public launchpad. Not a coworking pass."
- Four steps: a founder **identifies** a gap; the core team **curates** it "through governance by
  core contributors"; the asset is broken into named **bounties**; value appears **twice**, as
  real-world access and as a token whose worth rises per delivery.
- A bounty is "a name, a deliverable, and an exchange". Work bounties (design, legal, build,
  operate, host, write, ship) and financial bounties (capital is the deliverable) are "the same
  object". Both settle in that asset's token.
- One token per asset. "Founder Village does not run a single village-wide token."
- "The token starts with no value… Until someone delivers, the token is a claim on something that
  does not exist."
- Membership and ownership are separate layers: membership is how you use the village, the asset
  token is the claim on what you built.
- Village numbers, 2026: 3,000+ visitors, 370+ events, 47+ active members, 5+ new companies.
- Pipeline: Founder Haus (operating), Founder Desk, Founder Cafe, Founder Farm, Founder
  Residences, Little Founders of the Future School, Alternative Intelligence Accelerator (AIA),
  Longevity Hub, Founder Forge, FloripaDEZ.
- Founder Forge prototype is public at `craft-founder-ai.lovable.app`.
- AIA's first version: a 296-machine Mac mini cluster for data-sovereign model tests, running
  January 2025 to January 2026, hosted by Grupo Habitasul at Jurerê Beach Village.

## 2. `foundervillage.xyz/assets/founder-haus` — the live offering

- "This is a private offer exclusive for Founder Haus members and inner circle. Only white listed
  accounts can access the investment opportunity."
- Target **US$3.184M (~R$15.92M)** across four tranches. **US$214k raised, 17%.**
  - Stage 1 — completed — US$214k (~R$1.07M)
  - Stage 2 — in progress — US$300k (~R$1.5M)
  - Stage 3 — due 2029-02-11 — US$1.20M (~R$6.02M)
  - Stage 4 — due 2031-02-11 — US$1.47M (~R$7.33M)
- Contributions in **USDC**; the page offers to "Track USDC contributions" and to "Join bounty".
- Structure: **SPE Casa Founderhaus** holds the deed and the investors' quotas. **Founder Haus
  LTDA** operates the club and pays the SPE fixed rent, **4.5%**, "adjusted yearly by IPCA, over a
  10-year lease". The deed moves into the SPE "once the 2nd installment is paid". Operating risk
  is ring-fenced in the operating company; the tenant has been on site since August 2023.
- Property: Av. dos Merlins 156, Jurerê Internacional, Florianópolis, SC. Residential house,
  active since 2023.
- Deal room, six documents: white paper (open), **Founder Haus Forever SAFT template**
  (downloadable, "current participation-agreement template for legal review"), independent
  valuation (in preparation), title and registry diligence (in preparation), SPE and partner
  structure (in preparation), operating and financial diligence (controlled access).

**Do not fetch, copy or quote the controlled-access material into this repository.**

## 3. IslandDAO deck, 22 October 2026 — "Tokenizing a Neighborhood"

Presented by Paloma Lecheta, CEO of Founder Haus / Founder Village. Subtitle: "How Founder
Village is Putting Floripa's Infrastructure on **Solana**."

- Legal structure: **Founder Village Holding in Próspera**; one SPE per asset; Founder Haus LTDA
  as the operating business since 2023. Counsel: Silva Schütz Advogados and Flow Vista. A SAFE
  investor enters the holding.
- "The platform keeps **20%** of every tokenized asset," and the holding earns rental yield and
  appreciation on that stake.
- Founder Haus: beach club 80 m from the ocean, appraised **US$2.4M**, bought ~12% below
  appraisal, **US$214k already paid**, 600 m² lot, 504 m² built, rooftop terrace. Rental yield
  **4.5%/yr**, property appreciation **8.2%/yr**. Operating and profitable since 2023.
- Bounty loop as in source 1, plus: members act through **whitelisted wallets**, access "unlocked
  by an NFT wallet whitelist (Sept 2026 deck)", and they earn "ownership and profit tokens".
- Distribution is the stated edge: 4,324 founder leads on Luma, 420 events since 2023, 3,100
  visitors, ~1,000 qualified, 50+ founders in residence, ~4 pre-sales.
- Market framing: US$4T real estate tokenized globally by 2035 (Deloitte 2025) against ~US$10M
  tokenized in Brazil today (ABToken via Exame). Of the three hurdles, technology is "solved",
  legal is "advancing", and distribution is "the real challenge".
- Long-term: Jurerê, then Florianópolis, then startup societies, citing Próspera (~US$200M
  raised) and Praxis (US$525M committed).

### Unconfirmed in the deck itself

The author left notes asking to confirm, before asserting: that "every token starts at zero"; the
on-chain flow on Solana (mint, payouts, profit distribution); the platform's name, whether it is
live, and its URL; and whether NFT-whitelist access is current and which chain bounty tokens run
on. These became D-002 through D-006.

---

## 4. Prior art — Homerun (EVM)

`github.com/mejango/homerun`, read at HEAD `5adf3cd` on 2026-10-20. A two-token implementation
(FUND claiming sale proceeds, INCOME claiming revenue) on Juicebox V6 and Revnet, deployed and
verified at one CREATE2 address across Ethereum, Optimism, Base, Arbitrum and their Sepolia
testnets (deployer `0x19Ce092bc3f9662E40C4670C68ff03C8322D0E76`, revision `6e1ea4c`).

The full write-up is in `prior-art/homerun-fv-mechanism.md`. Its mechanism is superseded by the
bounty model; the four failure modes recorded in section 11.5 of the prompt are not.

## 5. Regulatory background

CVM Parecer de Orientação 40 treats a token sold with an expectation of return as a likely
security in Brazil. Tokenized real estate has no specific Brazilian regime, and a token confers no
title over the underlying property. Recorded as background, not as advice, and not as a
conclusion about this structure. See section 11.6 of the prompt.
