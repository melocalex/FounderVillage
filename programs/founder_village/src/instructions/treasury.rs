//! Capital and income. A plain transfer into a vault changes no accounting; only these
//! instructions do, and each one keeps a ledger counter next to the balance it moves.

use crate::{
    error::FounderVillageError,
    events::{DistributionClaimed, InflowRecorded, OutflowRecorded},
    sas::require_eligible,
    state::*,
};
use anchor_lang::prelude::*;
use anchor_spl::token_interface::{
    transfer_checked, Mint, TokenAccount, TokenInterface, TransferChecked,
};

#[event_cpi]
#[derive(Accounts)]
pub struct RecordInflow<'info> {
    pub payer: Signer<'info>,
    #[account(
        mut,
        constraint = asset.status == AssetStatus::Live @ FounderVillageError::AssetNotLive,
        has_one = contribution_mint @ FounderVillageError::WrongMint,
        has_one = income_vault @ FounderVillageError::WrongVault,
    )]
    pub asset: Box<Account<'info, Asset>>,
    pub contribution_mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(
        mut,
        token::mint = contribution_mint,
        token::authority = payer,
        token::token_program = contribution_token_program,
    )]
    pub payer_funds: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(mut)]
    pub income_vault: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(address = asset.contribution_token_program @ FounderVillageError::WrongMint)]
    pub contribution_token_program: Interface<'info, TokenInterface>,
}

/// Rent or revenue arrives. Anyone may pay it in (the operating company, in practice); it mints
/// nothing and raises every profit holder's claim pro rata. Refused before the first issuance.
pub fn record_inflow(mut ctx: Context<RecordInflow>, amount: u64) -> Result<()> {
    require!(amount > 0, FounderVillageError::ZeroAmount);
    let a = &mut ctx.accounts;
    transfer_checked(
        CpiContext::new(
            a.contribution_token_program.key(),
            TransferChecked {
                from: a.payer_funds.to_account_info(),
                mint: a.contribution_mint.to_account_info(),
                to: a.income_vault.to_account_info(),
                authority: a.payer.to_account_info(),
            },
        ),
        amount,
        a.contribution_mint.decimals,
    )?;
    a.asset.ledger.income = a
        .asset
        .ledger
        .income
        .checked_add(amount)
        .ok_or(FounderVillageError::MathOverflow)?;
    a.asset.distribute(amount)?;
    let event = InflowRecorded {
        asset: a.asset.key(),
        payer: a.payer.key(),
        amount,
        reward_index: a.asset.distribution.reward_index,
    };
    emit_cpi!(event);
    Ok(())
}

#[event_cpi]
#[derive(Accounts)]
pub struct RecordOutflow<'info> {
    pub council: Signer<'info>,
    #[account(
        mut,
        has_one = council @ FounderVillageError::NotCouncil,
        constraint = asset.status == AssetStatus::Live @ FounderVillageError::AssetNotLive,
        has_one = contribution_mint @ FounderVillageError::WrongMint,
        has_one = capital_vault @ FounderVillageError::WrongVault,
        has_one = spe_treasury @ FounderVillageError::WrongTreasury,
    )]
    pub asset: Box<Account<'info, Asset>>,
    pub contribution_mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(mut)]
    pub capital_vault: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(mut)]
    pub spe_treasury: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(address = asset.contribution_token_program @ FounderVillageError::WrongMint)]
    pub contribution_token_program: Interface<'info, TokenInterface>,
}

/// The council moves raised capital to the SPE (to pay the property installments). The only
/// destination is the treasury pinned at creation, and never more than was recorded.
pub fn record_outflow(
    mut ctx: Context<RecordOutflow>,
    amount: u64,
    memo_hash: [u8; 32],
) -> Result<()> {
    require!(amount > 0, FounderVillageError::ZeroAmount);
    let a = &mut ctx.accounts;
    let available = a
        .asset
        .ledger
        .contributed
        .checked_sub(a.asset.ledger.outflow)
        .ok_or(FounderVillageError::MathOverflow)?;
    require!(amount <= available, FounderVillageError::ExceedsCapital);
    let id = a.asset.asset_id.to_le_bytes();
    let bump = [a.asset.bump];
    let seeds: &[&[u8]] = &[ASSET_SEED, a.asset.creator.as_ref(), &id, &bump];
    transfer_checked(
        CpiContext::new_with_signer(
            a.contribution_token_program.key(),
            TransferChecked {
                from: a.capital_vault.to_account_info(),
                mint: a.contribution_mint.to_account_info(),
                to: a.spe_treasury.to_account_info(),
                authority: a.asset.to_account_info(),
            },
            &[seeds],
        ),
        amount,
        a.contribution_mint.decimals,
    )?;
    a.asset.ledger.outflow = a
        .asset
        .ledger
        .outflow
        .checked_add(amount)
        .ok_or(FounderVillageError::MathOverflow)?;
    let event = OutflowRecorded {
        asset: a.asset.key(),
        amount,
        memo_hash,
    };
    emit_cpi!(event);
    Ok(())
}

#[event_cpi]
#[derive(Accounts)]
pub struct ClaimDistribution<'info> {
    pub owner: Signer<'info>,
    #[account(
        mut,
        constraint = asset.status == AssetStatus::Live @ FounderVillageError::AssetNotLive,
        has_one = contribution_mint @ FounderVillageError::WrongMint,
        has_one = income_vault @ FounderVillageError::WrongVault,
    )]
    pub asset: Box<Account<'info, Asset>>,
    #[account(
        mut,
        seeds = [POSITION_SEED, asset.key().as_ref(), owner.key().as_ref()],
        bump = position.bump,
        has_one = owner @ FounderVillageError::WrongPosition,
    )]
    pub position: Box<Account<'info, Position>>,
    pub contribution_mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(
        mut,
        token::mint = contribution_mint,
        token::authority = owner,
        token::token_program = contribution_token_program,
    )]
    pub owner_funds: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(mut)]
    pub income_vault: Box<InterfaceAccount<'info, TokenAccount>>,
    /// CHECK: the owner's SAS attestation; verified in `sas::require_eligible`.
    pub attestation: UncheckedAccount<'info>,
    /// CHECK: must equal `asset.credential`; verified in `sas::require_eligible`.
    pub credential: UncheckedAccount<'info>,
    #[account(address = asset.contribution_token_program @ FounderVillageError::WrongMint)]
    pub contribution_token_program: Interface<'info, TokenInterface>,
}

/// A holder pulls everything they have accrued. An ineligible holder keeps accruing but cannot
/// withdraw until reinstated.
pub fn claim_distribution(mut ctx: Context<ClaimDistribution>) -> Result<()> {
    let a = &mut ctx.accounts;
    require_eligible(
        &a.attestation.to_account_info(),
        &a.credential.to_account_info(),
        &a.asset.credential,
        &a.asset.schema,
        &a.owner.key(),
    )?;
    a.position.settle(a.asset.distribution.reward_index)?;
    let amount = a.position.accrued;
    require!(amount > 0, FounderVillageError::NothingToClaim);
    a.position.accrued = 0;
    a.position.claimed = a
        .position
        .claimed
        .checked_add(amount)
        .ok_or(FounderVillageError::MathOverflow)?;
    let claimed = a
        .asset
        .ledger
        .income_claimed
        .checked_add(amount)
        .ok_or(FounderVillageError::MathOverflow)?;
    // Invariant: the program never pays out more income than it recorded.
    require!(
        claimed <= a.asset.ledger.income,
        FounderVillageError::MathOverflow
    );
    a.asset.ledger.income_claimed = claimed;

    let id = a.asset.asset_id.to_le_bytes();
    let bump = [a.asset.bump];
    let seeds: &[&[u8]] = &[ASSET_SEED, a.asset.creator.as_ref(), &id, &bump];
    transfer_checked(
        CpiContext::new_with_signer(
            a.contribution_token_program.key(),
            TransferChecked {
                from: a.income_vault.to_account_info(),
                mint: a.contribution_mint.to_account_info(),
                to: a.owner_funds.to_account_info(),
                authority: a.asset.to_account_info(),
            },
            &[seeds],
        ),
        amount,
        a.contribution_mint.decimals,
    )?;
    let event = DistributionClaimed {
        asset: a.asset.key(),
        owner: a.owner.key(),
        amount,
    };
    emit_cpi!(event);
    Ok(())
}
