use crate::state::{BountyKind, MintKind, Terms};
use anchor_lang::prelude::*;

#[event]
pub struct AssetCreated {
    pub asset: Pubkey,
    pub council: Pubkey,
    pub holding: Pubkey,
    pub holding_bps: u16,
}

#[event]
pub struct AssetLive {
    pub asset: Pubkey,
    pub ownership_mint: Pubkey,
    pub profit_mint: Pubkey,
}

#[event]
pub struct PositionOpened {
    pub asset: Pubkey,
    pub owner: Pubkey,
}

#[event]
pub struct HolderThawed {
    pub asset: Pubkey,
    pub mint: MintKind,
    pub owner: Pubkey,
    pub token_account: Pubkey,
}

#[event]
pub struct HolderFrozen {
    pub asset: Pubkey,
    pub mint: MintKind,
    pub owner: Pubkey,
    pub token_account: Pubkey,
}

#[event]
pub struct BountyProposed {
    pub asset: Pubkey,
    pub bounty: Pubkey,
    pub id: u64,
    pub kind: BountyKind,
    pub proposer: Pubkey,
}

#[event]
pub struct BountyCurated {
    pub bounty: Pubkey,
    pub terms: Terms,
}

#[event]
pub struct BountyOpened {
    pub bounty: Pubkey,
}

#[event]
pub struct BountyPaused {
    pub bounty: Pubkey,
}

#[event]
pub struct BountyResumed {
    pub bounty: Pubkey,
}

#[event]
pub struct Contributed {
    pub bounty: Pubkey,
    pub contributor: Pubkey,
    pub receipt: Pubkey,
    pub amount: u64,
    pub tokens: u64,
    pub holding_tokens: u64,
}

#[event]
pub struct FundingClosed {
    pub bounty: Pubkey,
    pub raised: u64,
}

#[event]
pub struct BountyClaimed {
    pub bounty: Pubkey,
    pub claimant: Pubkey,
}

#[event]
pub struct DeliverySubmitted {
    pub bounty: Pubkey,
    pub delivery_hash: [u8; 32],
}

#[event]
pub struct DeliveryAccepted {
    pub bounty: Pubkey,
}

#[event]
pub struct DeliveryRejected {
    pub bounty: Pubkey,
}

#[event]
pub struct WorkSettled {
    pub bounty: Pubkey,
    pub claimant: Pubkey,
    pub tokens: u64,
    pub holding_tokens: u64,
}

#[event]
pub struct BountyCancelled {
    pub bounty: Pubkey,
}

#[event]
pub struct InflowRecorded {
    pub asset: Pubkey,
    pub payer: Pubkey,
    pub amount: u64,
    pub reward_index: u128,
}

#[event]
pub struct OutflowRecorded {
    pub asset: Pubkey,
    pub amount: u64,
    pub memo_hash: [u8; 32],
}

#[event]
pub struct DistributionClaimed {
    pub asset: Pubkey,
    pub owner: Pubkey,
    pub amount: u64,
}
