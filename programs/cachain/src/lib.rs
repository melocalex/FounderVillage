//! Cachain: Founder Village's assets on Solana.
//!
//! One `Asset` per SPE. Each asset issues two Token-2022 tokens, ownership and profit, from
//! mints that are frozen by default: only wallets holding a live Solana Attestation Service
//! attestation can be thawed and hold them. Tokens come into existence only through bounties:
//! a financial bounty mints as USDC arrives, a work bounty mints when the council accepts the
//! delivery. Every issuance carries the holding's share. Rent paid in through `record_inflow`
//! is claimable pro rata by profit holders, tracked exactly through the profit mint's transfer
//! hook, so no authority ever states who the holders are.
#![deny(unsafe_code)]

use anchor_lang::prelude::*;
use spl_discriminator::SplDiscriminate;
use spl_transfer_hook_interface::instruction::ExecuteInstruction;

pub mod error;
pub mod events;
pub mod instructions;
pub mod math;
pub mod sas;
pub mod state;
pub mod token;

use instructions::*;
use state::{BountyKind, Terms};
use token::TokenMeta;

declare_id!("CachxfgQfNcVhvjGGY5KMTSijdP8SVx4MqDxDniyQP6S");

#[program]
pub mod cachain {
    use super::*;

    // Setup ---------------------------------------------------------------------------------

    /// Creates the asset account and its USDC vaults from the policy numbers in the config file.
    pub fn create_asset(ctx: Context<CreateAsset>, args: CreateAssetArgs) -> Result<()> {
        instructions::create_asset(ctx, args)
    }

    /// Creates both Token-2022 mints with their fixed extension set and makes the asset live.
    pub fn create_mints(
        ctx: Context<CreateMints>,
        ownership: TokenMeta,
        profit: TokenMeta,
    ) -> Result<()> {
        instructions::create_mints(ctx, ownership, profit)
    }

    // Eligibility ---------------------------------------------------------------------------

    pub fn open_position(ctx: Context<OpenPosition>) -> Result<()> {
        instructions::open_position(ctx)
    }

    pub fn thaw_holder(ctx: Context<Gate>) -> Result<()> {
        instructions::thaw_holder(ctx)
    }

    pub fn freeze_holder(ctx: Context<Gate>) -> Result<()> {
        instructions::freeze_holder(ctx)
    }

    // Bounties ------------------------------------------------------------------------------

    pub fn propose_bounty(
        ctx: Context<ProposeBounty>,
        kind: BountyKind,
        title: String,
        spec_hash: [u8; 32],
    ) -> Result<()> {
        instructions::propose_bounty(ctx, kind, title, spec_hash)
    }

    pub fn curate_bounty(ctx: Context<CouncilBounty>, terms: Terms) -> Result<()> {
        instructions::curate_bounty(ctx, terms)
    }

    pub fn open_bounty(ctx: Context<CouncilBounty>) -> Result<()> {
        instructions::open_bounty(ctx)
    }

    pub fn pause_bounty(ctx: Context<CouncilBounty>) -> Result<()> {
        instructions::pause_bounty(ctx)
    }

    pub fn resume_bounty(ctx: Context<CouncilBounty>) -> Result<()> {
        instructions::resume_bounty(ctx)
    }

    pub fn close_funding(ctx: Context<CouncilBounty>) -> Result<()> {
        instructions::close_funding(ctx)
    }

    pub fn cancel_bounty(ctx: Context<CouncilBounty>) -> Result<()> {
        instructions::cancel_bounty(ctx)
    }

    pub fn contribute(ctx: Context<Contribute>, amount: u64, receipt_id: u64) -> Result<()> {
        instructions::contribute(ctx, amount, receipt_id)
    }

    pub fn claim_bounty(ctx: Context<ClaimBounty>) -> Result<()> {
        instructions::claim_bounty(ctx)
    }

    pub fn submit_delivery(ctx: Context<SubmitDelivery>, delivery_hash: [u8; 32]) -> Result<()> {
        instructions::submit_delivery(ctx, delivery_hash)
    }

    pub fn accept_delivery(ctx: Context<CouncilBounty>) -> Result<()> {
        instructions::accept_delivery(ctx)
    }

    pub fn reject_delivery(ctx: Context<CouncilBounty>) -> Result<()> {
        instructions::reject_delivery(ctx)
    }

    pub fn settle_work(ctx: Context<SettleWork>) -> Result<()> {
        instructions::settle_work(ctx)
    }

    // Treasury ------------------------------------------------------------------------------

    pub fn record_inflow(ctx: Context<RecordInflow>, amount: u64) -> Result<()> {
        instructions::record_inflow(ctx, amount)
    }

    pub fn record_outflow(
        ctx: Context<RecordOutflow>,
        amount: u64,
        memo_hash: [u8; 32],
    ) -> Result<()> {
        instructions::record_outflow(ctx, amount, memo_hash)
    }

    pub fn claim_distribution(ctx: Context<ClaimDistribution>) -> Result<()> {
        instructions::claim_distribution(ctx)
    }

    // Transfer hook -------------------------------------------------------------------------

    /// SPL transfer-hook `execute`, called by Token-2022 on every profit-token transfer.
    #[instruction(discriminator = ExecuteInstruction::SPL_DISCRIMINATOR_SLICE)]
    pub fn execute(ctx: Context<Execute>, amount: u64) -> Result<()> {
        instructions::execute(ctx, amount)
    }
}
