use anchor_lang::prelude::*;

pub const ASSET_SEED: &[u8] = b"asset";
pub const MINT_SEED: &[u8] = b"mint";
pub const CAPITAL_VAULT_SEED: &[u8] = b"capital";
pub const INCOME_VAULT_SEED: &[u8] = b"income";
pub const BOUNTY_SEED: &[u8] = b"bounty";
pub const POSITION_SEED: &[u8] = b"position";
pub const RECEIPT_SEED: &[u8] = b"receipt";
pub const EXTRA_METAS_SEED: &[u8] = b"extra-account-metas";

pub const MAX_TITLE_LEN: usize = 64;
pub const MAX_NAME_LEN: usize = 32;
pub const MAX_SYMBOL_LEN: usize = 10;
pub const MAX_URI_LEN: usize = 128;
pub const BPS_DENOMINATOR: u16 = 10_000;

/// Which of the asset's two tokens a mint is. The byte is the PDA seed of the mint.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug, InitSpace)]
pub enum MintKind {
    /// Claim on the asset itself (the SPE quota).
    Ownership,
    /// Claim on the asset's recorded income (rent and revenue).
    Profit,
}

impl MintKind {
    pub fn seed(self) -> [u8; 1] {
        match self {
            MintKind::Ownership => [0],
            MintKind::Profit => [1],
        }
    }
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug, InitSpace)]
pub enum AssetStatus {
    /// Account and vaults exist; mints do not yet.
    Created,
    /// Both mints exist with their extension set fixed; every other instruction is open.
    Live,
}

/// One tokenized asset (one SPE). Every policy number lives here, written once from the config file.
#[account]
#[derive(InitSpace)]
pub struct Asset {
    pub creator: Pubkey,
    pub asset_id: u64,
    pub bump: u8,
    pub status: AssetStatus,
    /// Signs curation, acceptance, pauses and outflows. A Squads vault in every deployment.
    pub council: Pubkey,
    /// Owner of the holding's token accounts; receives `holding_bps` of every issuance.
    pub holding: Pubkey,
    /// The only token account capital may leave to (the SPE's account).
    pub spe_treasury: Pubkey,
    /// USDC on mainnet; a local or devnet mint elsewhere.
    pub contribution_mint: Pubkey,
    pub contribution_token_program: Pubkey,
    pub capital_vault: Pubkey,
    pub income_vault: Pubkey,
    pub ownership_mint: Pubkey,
    pub profit_mint: Pubkey,
    /// Solana Attestation Service credential and schema the eligibility gate accepts.
    pub credential: Pubkey,
    pub schema: Pubkey,
    pub holding_bps: u16,
    pub decimals: u8,
    pub next_bounty_id: u64,
    pub ledger: Ledger,
    pub distribution: Distribution,
}

#[derive(
    AnchorSerialize, AnchorDeserialize, Clone, Copy, Default, PartialEq, Eq, Debug, InitSpace,
)]
pub struct Ledger {
    /// USDC received into the capital vault through `contribute`.
    pub contributed: u64,
    /// USDC sent from the capital vault to the SPE through `record_outflow`.
    pub outflow: u64,
    /// USDC received into the income vault through `record_inflow`.
    pub income: u64,
    /// USDC paid from the income vault through `claim_distribution`.
    pub income_claimed: u64,
}

/// Pull-distribution accumulator over profit-token balances the program tracks itself.
#[derive(
    AnchorSerialize, AnchorDeserialize, Clone, Copy, Default, PartialEq, Eq, Debug, InitSpace,
)]
pub struct Distribution {
    /// Cumulative income per profit-token base unit, scaled by `math::INDEX_SCALE`.
    pub reward_index: u128,
    /// Sum of every `Position::balance`: every profit token ever minted. Burns skip the hook,
    /// so a burned token keeps its income share with the burner; nobody else's share shrinks.
    pub tracked_supply: u64,
    /// Recorded income the index could not yet represent, in index units (amount scaled by
    /// `math::INDEX_SCALE`). Always below `tracked_supply`; folded into the next inflow.
    pub carry: u64,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug, InitSpace)]
pub enum BountyKind {
    /// Delivered as work; settles by minting `reward` to the claimant.
    Work,
    /// Delivered as capital; each contribution mints at `price` in the same transaction.
    Financial,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug, InitSpace)]
pub enum BountyState {
    Proposed,
    Curated,
    Open,
    /// Financial only: contributions refused until resumed.
    Paused,
    /// Work only: a member took it on.
    Claimed,
    Delivered,
    Accepted,
    Rejected,
    Settled,
    Cancelled,
}

/// The exchange, fixed at curation and never written again.
#[derive(
    AnchorSerialize, AnchorDeserialize, Clone, Copy, Default, PartialEq, Eq, Debug, InitSpace,
)]
pub struct Terms {
    /// Work: asset tokens (base units, before the holding split) paid on settlement.
    pub reward: u64,
    /// Financial: asset tokens minted per contribution = amount * price_num / price_den.
    pub price_num: u64,
    pub price_den: u64,
    /// Financial: most USDC the bounty accepts.
    pub target: u64,
    /// Financial: unix time after which contributions are refused; 0 means none.
    pub deadline: i64,
}

#[account]
#[derive(InitSpace)]
pub struct Bounty {
    pub asset: Pubkey,
    pub id: u64,
    pub bump: u8,
    pub kind: BountyKind,
    pub state: BountyState,
    pub proposer: Pubkey,
    #[max_len(MAX_TITLE_LEN)]
    pub title: String,
    /// Hash of the off-chain description of the deliverable.
    pub spec_hash: [u8; 32],
    pub terms: Terms,
    /// Financial: USDC received.
    pub raised: u64,
    /// Asset tokens minted to members by this bounty, holding split excluded.
    pub minted: u64,
    /// Work: the member who claimed it.
    pub claimant: Pubkey,
    /// Work: hash of what was delivered.
    pub delivery_hash: [u8; 32],
}

/// One holder's share of the profit-token distribution.
#[account]
#[derive(InitSpace)]
pub struct Position {
    pub asset: Pubkey,
    pub owner: Pubkey,
    pub bump: u8,
    /// Profit tokens this owner holds across all of their token accounts.
    pub balance: u64,
    /// `Distribution::reward_index` at the last settlement.
    pub index: u128,
    /// Income earned and not yet claimed.
    pub accrued: u64,
    /// Income paid out over the position's life.
    pub claimed: u64,
}

/// Receipt of one USDC contribution to a financial bounty.
#[account]
#[derive(InitSpace)]
pub struct Receipt {
    pub bounty: Pubkey,
    pub contributor: Pubkey,
    pub receipt_id: u64,
    pub bump: u8,
    pub amount: u64,
    pub tokens: u64,
    pub timestamp: i64,
}
