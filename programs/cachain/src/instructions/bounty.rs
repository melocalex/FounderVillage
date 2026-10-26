//! The bounty state machine. Every transition is its own instruction with its own signer:
//!
//! Proposed → Curated → Open ─┬─ (work)      → Claimed → Delivered ─┬→ Accepted → Settled
//!     │          │       │   │                                     └→ Rejected
//!     │          │       │   └─ (financial) ⇄ Paused; Open|Paused → Settled (close_funding)
//!     └──────────┴───────┴→ Cancelled (no capital raised)
//!
//! Curation, opening, pausing, closing, acceptance and rejection need the council signature,
//! and the council is a Squads vault, so no single key can perform them.

use crate::{error::CachainError, events::*, sas::require_eligible, state::*};
use anchor_lang::prelude::*;

#[event_cpi]
#[derive(Accounts)]
pub struct ProposeBounty<'info> {
    #[account(mut)]
    pub proposer: Signer<'info>,
    #[account(mut, constraint = asset.status == AssetStatus::Live @ CachainError::AssetNotLive)]
    pub asset: Box<Account<'info, Asset>>,
    #[account(
        init,
        payer = proposer,
        space = 8 + Bounty::INIT_SPACE,
        seeds = [BOUNTY_SEED, asset.key().as_ref(), &asset.next_bounty_id.to_le_bytes()],
        bump,
    )]
    pub bounty: Box<Account<'info, Bounty>>,
    /// CHECK: the proposer's SAS attestation; verified in `sas::require_eligible`.
    pub attestation: UncheckedAccount<'info>,
    /// CHECK: must equal `asset.credential`; verified in `sas::require_eligible`.
    pub credential: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

/// A member names a gap. Only eligible members may propose.
pub fn propose_bounty(
    ctx: Context<ProposeBounty>,
    kind: BountyKind,
    title: String,
    spec_hash: [u8; 32],
) -> Result<()> {
    require!(
        !title.is_empty() && title.len() <= MAX_TITLE_LEN,
        CachainError::InvalidTitle
    );
    let asset = &mut ctx.accounts.asset;
    require_eligible(
        &ctx.accounts.attestation.to_account_info(),
        &ctx.accounts.credential.to_account_info(),
        &asset.credential,
        &asset.schema,
        &ctx.accounts.proposer.key(),
    )?;
    let id = asset.next_bounty_id;
    asset.next_bounty_id = id.checked_add(1).ok_or(CachainError::MathOverflow)?;
    ctx.accounts.bounty.set_inner(Bounty {
        asset: asset.key(),
        id,
        bump: ctx.bumps.bounty,
        kind,
        state: BountyState::Proposed,
        proposer: ctx.accounts.proposer.key(),
        title,
        spec_hash,
        terms: Terms::default(),
        raised: 0,
        minted: 0,
        claimant: Pubkey::default(),
        delivery_hash: [0; 32],
    });
    emit_cpi!(BountyProposed {
        asset: asset.key(),
        bounty: ctx.accounts.bounty.key(),
        id,
        kind,
        proposer: ctx.accounts.proposer.key(),
    });
    Ok(())
}

#[event_cpi]
#[derive(Accounts)]
pub struct CouncilBounty<'info> {
    pub council: Signer<'info>,
    #[account(
        has_one = council @ CachainError::NotCouncil,
        constraint = asset.status == AssetStatus::Live @ CachainError::AssetNotLive,
    )]
    pub asset: Box<Account<'info, Asset>>,
    #[account(mut, has_one = asset)]
    pub bounty: Box<Account<'info, Bounty>>,
}

fn transition(bounty: &mut Bounty, from: &[BountyState], to: BountyState) -> Result<()> {
    require!(
        from.contains(&bounty.state),
        CachainError::InvalidBountyState
    );
    bounty.state = to;
    Ok(())
}

/// The council accepts a proposal and writes the exchange. The terms are never written again.
pub fn curate_bounty(ctx: Context<CouncilBounty>, terms: Terms) -> Result<()> {
    let bounty = &mut ctx.accounts.bounty;
    match bounty.kind {
        BountyKind::Work => {
            require!(terms.reward > 0, CachainError::InvalidReward);
            require!(
                terms.price_num == 0
                    && terms.price_den == 0
                    && terms.target == 0
                    && terms.deadline == 0,
                CachainError::WrongBountyKind
            );
        }
        BountyKind::Financial => {
            require!(
                terms.price_num > 0 && terms.price_den > 0,
                CachainError::InvalidPrice
            );
            require!(terms.target > 0, CachainError::InvalidTarget);
            require!(terms.reward == 0, CachainError::WrongBountyKind);
            require!(
                terms.deadline == 0 || terms.deadline > Clock::get()?.unix_timestamp,
                CachainError::InvalidDeadline
            );
        }
    }
    transition(bounty, &[BountyState::Proposed], BountyState::Curated)?;
    bounty.terms = terms;
    emit_cpi!(BountyCurated {
        bounty: bounty.key(),
        terms
    });
    Ok(())
}

pub fn open_bounty(ctx: Context<CouncilBounty>) -> Result<()> {
    let bounty = &mut ctx.accounts.bounty;
    transition(bounty, &[BountyState::Curated], BountyState::Open)?;
    emit_cpi!(BountyOpened {
        bounty: bounty.key()
    });
    Ok(())
}

pub fn pause_bounty(ctx: Context<CouncilBounty>) -> Result<()> {
    let bounty = &mut ctx.accounts.bounty;
    require!(
        bounty.kind == BountyKind::Financial,
        CachainError::WrongBountyKind
    );
    transition(bounty, &[BountyState::Open], BountyState::Paused)?;
    emit_cpi!(BountyPaused {
        bounty: bounty.key()
    });
    Ok(())
}

pub fn resume_bounty(ctx: Context<CouncilBounty>) -> Result<()> {
    let bounty = &mut ctx.accounts.bounty;
    require!(
        bounty.kind == BountyKind::Financial,
        CachainError::WrongBountyKind
    );
    transition(bounty, &[BountyState::Paused], BountyState::Open)?;
    emit_cpi!(BountyResumed {
        bounty: bounty.key()
    });
    Ok(())
}

/// Ends a financial bounty (a tranche close). What raised stays raised; there are no refunds
/// on-chain, and a shortfall against the target is handled off-chain.
pub fn close_funding(ctx: Context<CouncilBounty>) -> Result<()> {
    let bounty = &mut ctx.accounts.bounty;
    require!(
        bounty.kind == BountyKind::Financial,
        CachainError::WrongBountyKind
    );
    transition(
        bounty,
        &[BountyState::Open, BountyState::Paused],
        BountyState::Settled,
    )?;
    emit_cpi!(FundingClosed {
        bounty: bounty.key(),
        raised: bounty.raised
    });
    Ok(())
}

pub fn cancel_bounty(ctx: Context<CouncilBounty>) -> Result<()> {
    let bounty = &mut ctx.accounts.bounty;
    require!(bounty.raised == 0, CachainError::FundsRaised);
    transition(
        bounty,
        &[
            BountyState::Proposed,
            BountyState::Curated,
            BountyState::Open,
        ],
        BountyState::Cancelled,
    )?;
    emit_cpi!(BountyCancelled {
        bounty: bounty.key()
    });
    Ok(())
}

pub fn accept_delivery(ctx: Context<CouncilBounty>) -> Result<()> {
    let bounty = &mut ctx.accounts.bounty;
    transition(bounty, &[BountyState::Delivered], BountyState::Accepted)?;
    emit_cpi!(DeliveryAccepted {
        bounty: bounty.key()
    });
    Ok(())
}

/// A rejected delivery is terminal and mints nothing.
pub fn reject_delivery(ctx: Context<CouncilBounty>) -> Result<()> {
    let bounty = &mut ctx.accounts.bounty;
    transition(bounty, &[BountyState::Delivered], BountyState::Rejected)?;
    emit_cpi!(DeliveryRejected {
        bounty: bounty.key()
    });
    Ok(())
}

#[event_cpi]
#[derive(Accounts)]
pub struct ClaimBounty<'info> {
    pub claimant: Signer<'info>,
    #[account(constraint = asset.status == AssetStatus::Live @ CachainError::AssetNotLive)]
    pub asset: Box<Account<'info, Asset>>,
    #[account(
        mut,
        has_one = asset,
        constraint = bounty.kind == BountyKind::Work @ CachainError::WrongBountyKind,
    )]
    pub bounty: Box<Account<'info, Bounty>>,
    /// CHECK: the claimant's SAS attestation; verified in `sas::require_eligible`.
    pub attestation: UncheckedAccount<'info>,
    /// CHECK: must equal `asset.credential`; verified in `sas::require_eligible`.
    pub credential: UncheckedAccount<'info>,
}

/// An eligible member takes on an open work bounty.
pub fn claim_bounty(ctx: Context<ClaimBounty>) -> Result<()> {
    let asset = &ctx.accounts.asset;
    require_eligible(
        &ctx.accounts.attestation.to_account_info(),
        &ctx.accounts.credential.to_account_info(),
        &asset.credential,
        &asset.schema,
        &ctx.accounts.claimant.key(),
    )?;
    let bounty = &mut ctx.accounts.bounty;
    transition(bounty, &[BountyState::Open], BountyState::Claimed)?;
    bounty.claimant = ctx.accounts.claimant.key();
    emit_cpi!(BountyClaimed {
        bounty: bounty.key(),
        claimant: bounty.claimant
    });
    Ok(())
}

#[event_cpi]
#[derive(Accounts)]
pub struct SubmitDelivery<'info> {
    pub claimant: Signer<'info>,
    #[account(mut, has_one = claimant @ CachainError::NotClaimant)]
    pub bounty: Box<Account<'info, Bounty>>,
}

pub fn submit_delivery(ctx: Context<SubmitDelivery>, delivery_hash: [u8; 32]) -> Result<()> {
    require!(delivery_hash != [0; 32], CachainError::EmptyDelivery);
    let bounty = &mut ctx.accounts.bounty;
    transition(bounty, &[BountyState::Claimed], BountyState::Delivered)?;
    bounty.delivery_hash = delivery_hash;
    emit_cpi!(DeliverySubmitted {
        bounty: bounty.key(),
        delivery_hash
    });
    Ok(())
}
