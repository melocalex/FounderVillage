//! The eligibility gate. Asset mints are frozen by default, so an account can only hold the
//! token after `thaw_holder` proves a live attestation; `freeze_holder` lets anyone re-freeze
//! an account whose attestation was revoked or expired. Balances survive a freeze.

use crate::{
    error::CachainError,
    events::{HolderFrozen, HolderThawed, PositionOpened},
    sas::{require_eligible, standing, Standing},
    state::*,
};
use anchor_lang::prelude::*;
use anchor_spl::{
    token_2022::Token2022,
    token_interface::{
        freeze_account, thaw_account, FreezeAccount, Mint, ThawAccount, TokenAccount,
    },
};

#[event_cpi]
#[derive(Accounts)]
pub struct OpenPosition<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(constraint = asset.status == AssetStatus::Live @ CachainError::AssetNotLive)]
    pub asset: Box<Account<'info, Asset>>,
    /// CHECK: any wallet; used only as the position's seed and owner field.
    pub owner: UncheckedAccount<'info>,
    #[account(
        init,
        payer = payer,
        space = 8 + Position::INIT_SPACE,
        seeds = [POSITION_SEED, asset.key().as_ref(), owner.key().as_ref()],
        bump,
    )]
    pub position: Box<Account<'info, Position>>,
    pub system_program: Program<'info, System>,
}

pub fn open_position(ctx: Context<OpenPosition>) -> Result<()> {
    let asset = &ctx.accounts.asset;
    ctx.accounts.position.set_inner(Position {
        asset: asset.key(),
        owner: ctx.accounts.owner.key(),
        bump: ctx.bumps.position,
        balance: 0,
        // A new position earns only from inflows recorded after it exists.
        index: asset.distribution.reward_index,
        accrued: 0,
        claimed: 0,
    });
    emit_cpi!(PositionOpened {
        asset: asset.key(),
        owner: ctx.accounts.owner.key()
    });
    Ok(())
}

#[event_cpi]
#[derive(Accounts)]
pub struct Gate<'info> {
    #[account(constraint = asset.status == AssetStatus::Live @ CachainError::AssetNotLive)]
    pub asset: Box<Account<'info, Asset>>,
    /// CHECK: the holder wallet; its standing comes from the attestation below.
    pub owner: UncheckedAccount<'info>,
    #[account(
        constraint = mint.key() == asset.ownership_mint || mint.key() == asset.profit_mint
            @ CachainError::WrongMint,
    )]
    pub mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(
        mut,
        token::mint = mint,
        token::authority = owner,
        token::token_program = token_program,
    )]
    pub token_account: Box<InterfaceAccount<'info, TokenAccount>>,
    /// CHECK: the SAS attestation PDA for (asset.credential, asset.schema, owner); the address
    /// is re-derived and the contents parsed in `sas::standing`.
    pub attestation: UncheckedAccount<'info>,
    /// CHECK: must equal `asset.credential` and be SAS-owned; checked in `sas::standing`.
    pub credential: UncheckedAccount<'info>,
    pub token_program: Program<'info, Token2022>,
}

impl<'info> Gate<'info> {
    fn asset_seeds_parts(&self) -> ([u8; 8], [u8; 1]) {
        (self.asset.asset_id.to_le_bytes(), [self.asset.bump])
    }
}

/// Thaws a holder's token account. Permissionless: anyone may pay to thaw an eligible holder.
pub fn thaw_holder(ctx: Context<Gate>) -> Result<()> {
    let a = &ctx.accounts;
    require_eligible(
        &a.attestation.to_account_info(),
        &a.credential.to_account_info(),
        &a.asset.credential,
        &a.asset.schema,
        &a.owner.key(),
    )?;
    require!(a.token_account.is_frozen(), CachainError::AlreadyThawed);
    let (id, bump) = a.asset_seeds_parts();
    let seeds: &[&[u8]] = &[ASSET_SEED, a.asset.creator.as_ref(), &id, &bump];
    thaw_account(CpiContext::new_with_signer(
        a.token_program.key(),
        ThawAccount {
            account: a.token_account.to_account_info(),
            mint: a.mint.to_account_info(),
            authority: a.asset.to_account_info(),
        },
        &[seeds],
    ))?;
    emit_cpi!(HolderThawed {
        asset: a.asset.key(),
        mint: a.asset.kind_of(&a.mint.key())?,
        owner: a.owner.key(),
        token_account: a.token_account.key(),
    });
    Ok(())
}

/// Freezes a holder whose attestation is gone, expired, or signed by a removed signer.
/// Permissionless, because revocation must not depend on one key remembering to act.
pub fn freeze_holder(ctx: Context<Gate>) -> Result<()> {
    let a = &ctx.accounts;
    let standing = standing(
        &a.attestation.to_account_info(),
        &a.credential.to_account_info(),
        &a.asset.credential,
        &a.asset.schema,
        &a.owner.key(),
    )?;
    require!(standing != Standing::Eligible, CachainError::StillEligible);
    require!(!a.token_account.is_frozen(), CachainError::AlreadyFrozen);
    let (id, bump) = a.asset_seeds_parts();
    let seeds: &[&[u8]] = &[ASSET_SEED, a.asset.creator.as_ref(), &id, &bump];
    freeze_account(CpiContext::new_with_signer(
        a.token_program.key(),
        FreezeAccount {
            account: a.token_account.to_account_info(),
            mint: a.mint.to_account_info(),
            authority: a.asset.to_account_info(),
        },
        &[seeds],
    ))?;
    emit_cpi!(HolderFrozen {
        asset: a.asset.key(),
        mint: a.asset.kind_of(&a.mint.key())?,
        owner: a.owner.key(),
        token_account: a.token_account.key(),
    });
    Ok(())
}
