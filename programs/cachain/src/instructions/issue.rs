//! The two ways asset tokens come into existence, and the one function both use.
//! Every issuance mints ownership and profit tokens in equal amounts to the member, mints the
//! holding's share alongside, and credits both positions, so the holding split and the
//! distribution ledger cannot be skipped by any mint path.

use crate::{
    error::CachainError,
    events::{Contributed, WorkSettled},
    math::{holding_share, tokens_for},
    sas::require_eligible,
    state::*,
    token::mint_asset_token,
};
use anchor_lang::prelude::*;
use anchor_spl::{
    token_2022::Token2022,
    token_interface::{transfer_checked, Mint, TokenAccount, TokenInterface, TransferChecked},
};

struct Issue<'a, 'info> {
    token_program: AccountInfo<'info>,
    asset: AccountInfo<'info>,
    ownership_mint: AccountInfo<'info>,
    profit_mint: AccountInfo<'info>,
    member_ownership: &'a InterfaceAccount<'info, TokenAccount>,
    member_profit: &'a InterfaceAccount<'info, TokenAccount>,
    holding_ownership: &'a InterfaceAccount<'info, TokenAccount>,
    holding_profit: &'a InterfaceAccount<'info, TokenAccount>,
}

/// Mints `member_tokens` of each asset token to the member and the holding's share to the
/// holding. Returns the holding's share.
fn issue(
    asset: &mut Asset,
    accounts: Issue,
    member_position: &mut Position,
    holding_position: &mut Position,
    member_tokens: u64,
) -> Result<u64> {
    for account in [
        accounts.member_ownership,
        accounts.member_profit,
        accounts.holding_ownership,
        accounts.holding_profit,
    ] {
        require!(!account.is_frozen(), CachainError::HolderFrozen);
    }
    let holding_tokens = holding_share(member_tokens, asset.holding_bps)?;
    let id = asset.asset_id.to_le_bytes();
    let bump = [asset.bump];
    let seeds: &[&[u8]] = &[ASSET_SEED, asset.creator.as_ref(), &id, &bump];
    for (mint, to, amount) in [
        (
            &accounts.ownership_mint,
            accounts.member_ownership,
            member_tokens,
        ),
        (&accounts.profit_mint, accounts.member_profit, member_tokens),
        (
            &accounts.ownership_mint,
            accounts.holding_ownership,
            holding_tokens,
        ),
        (
            &accounts.profit_mint,
            accounts.holding_profit,
            holding_tokens,
        ),
    ] {
        mint_asset_token(
            &accounts.token_program,
            mint,
            &to.to_account_info(),
            &accounts.asset,
            &[seeds],
            amount,
        )?;
    }
    let index = asset.distribution.reward_index;
    member_position.credit(index, member_tokens)?;
    holding_position.credit(index, holding_tokens)?;
    asset.track_profit(
        member_tokens
            .checked_add(holding_tokens)
            .ok_or(CachainError::MathOverflow)?,
    )?;
    Ok(holding_tokens)
}

#[event_cpi]
#[derive(Accounts)]
#[instruction(amount: u64, receipt_id: u64)]
pub struct Contribute<'info> {
    #[account(mut)]
    pub contributor: Signer<'info>,
    #[account(
        mut,
        constraint = asset.status == AssetStatus::Live @ CachainError::AssetNotLive,
        has_one = contribution_mint @ CachainError::WrongMint,
        has_one = capital_vault @ CachainError::WrongVault,
        has_one = ownership_mint @ CachainError::WrongMint,
        has_one = profit_mint @ CachainError::WrongMint,
    )]
    pub asset: Box<Account<'info, Asset>>,
    #[account(
        mut,
        has_one = asset,
        constraint = bounty.kind == BountyKind::Financial @ CachainError::WrongBountyKind,
    )]
    pub bounty: Box<Account<'info, Bounty>>,
    #[account(
        init,
        payer = contributor,
        space = 8 + Receipt::INIT_SPACE,
        seeds = [RECEIPT_SEED, bounty.key().as_ref(), contributor.key().as_ref(), &receipt_id.to_le_bytes()],
        bump,
    )]
    pub receipt: Box<Account<'info, Receipt>>,
    pub contribution_mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(
        mut,
        token::mint = contribution_mint,
        token::authority = contributor,
        token::token_program = contribution_token_program,
    )]
    pub contributor_funds: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(mut)]
    pub capital_vault: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(mut)]
    pub ownership_mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(mut)]
    pub profit_mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(mut, token::mint = ownership_mint, token::authority = contributor, token::token_program = token_program)]
    pub contributor_ownership: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(mut, token::mint = profit_mint, token::authority = contributor, token::token_program = token_program)]
    pub contributor_profit: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(
        mut,
        seeds = [POSITION_SEED, asset.key().as_ref(), contributor.key().as_ref()],
        bump = contributor_position.bump,
    )]
    pub contributor_position: Box<Account<'info, Position>>,
    #[account(
        mut,
        token::mint = ownership_mint,
        token::token_program = token_program,
        constraint = holding_ownership.owner == asset.holding @ CachainError::WrongHoldingAccount,
    )]
    pub holding_ownership: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(
        mut,
        token::mint = profit_mint,
        token::token_program = token_program,
        constraint = holding_profit.owner == asset.holding @ CachainError::WrongHoldingAccount,
    )]
    pub holding_profit: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(
        mut,
        seeds = [POSITION_SEED, asset.key().as_ref(), asset.holding.as_ref()],
        bump = holding_position.bump,
    )]
    pub holding_position: Box<Account<'info, Position>>,
    /// CHECK: the contributor's SAS attestation; verified in `sas::require_eligible`.
    pub attestation: UncheckedAccount<'info>,
    /// CHECK: must equal `asset.credential`; verified in `sas::require_eligible`.
    pub credential: UncheckedAccount<'info>,
    pub token_program: Program<'info, Token2022>,
    #[account(address = asset.contribution_token_program @ CachainError::WrongMint)]
    pub contribution_token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}

/// A member funds a financial bounty: USDC moves into the capital vault and the claim mints in
/// the same transaction, at the price fixed at curation.
pub fn contribute(mut ctx: Context<Contribute>, amount: u64, receipt_id: u64) -> Result<()> {
    require!(amount > 0, CachainError::ZeroAmount);
    let a = &mut ctx.accounts;
    require!(
        a.bounty.state == BountyState::Open,
        CachainError::InvalidBountyState
    );
    let terms = a.bounty.terms;
    let now = Clock::get()?.unix_timestamp;
    require!(
        terms.deadline == 0 || now <= terms.deadline,
        CachainError::DeadlinePassed
    );
    let raised = a
        .bounty
        .raised
        .checked_add(amount)
        .ok_or(CachainError::MathOverflow)?;
    require!(raised <= terms.target, CachainError::ExceedsTarget);
    require_eligible(
        &a.attestation.to_account_info(),
        &a.credential.to_account_info(),
        &a.asset.credential,
        &a.asset.schema,
        &a.contributor.key(),
    )?;
    let tokens = tokens_for(amount, terms.price_num, terms.price_den)?;
    require!(tokens > 0, CachainError::ZeroTokens);

    transfer_checked(
        CpiContext::new(
            a.contribution_token_program.key(),
            TransferChecked {
                from: a.contributor_funds.to_account_info(),
                mint: a.contribution_mint.to_account_info(),
                to: a.capital_vault.to_account_info(),
                authority: a.contributor.to_account_info(),
            },
        ),
        amount,
        a.contribution_mint.decimals,
    )?;

    let accounts = Issue {
        token_program: a.token_program.to_account_info(),
        asset: a.asset.to_account_info(),
        ownership_mint: a.ownership_mint.to_account_info(),
        profit_mint: a.profit_mint.to_account_info(),
        member_ownership: &a.contributor_ownership,
        member_profit: &a.contributor_profit,
        holding_ownership: &a.holding_ownership,
        holding_profit: &a.holding_profit,
    };
    let holding_tokens = issue(
        &mut a.asset,
        accounts,
        &mut a.contributor_position,
        &mut a.holding_position,
        tokens,
    )?;

    a.bounty.raised = raised;
    a.bounty.minted = a
        .bounty
        .minted
        .checked_add(tokens)
        .ok_or(CachainError::MathOverflow)?;
    a.asset.ledger.contributed = a
        .asset
        .ledger
        .contributed
        .checked_add(amount)
        .ok_or(CachainError::MathOverflow)?;
    a.receipt.set_inner(Receipt {
        bounty: a.bounty.key(),
        contributor: a.contributor.key(),
        receipt_id,
        bump: ctx.bumps.receipt,
        amount,
        tokens,
        timestamp: now,
    });
    let event = Contributed {
        bounty: a.bounty.key(),
        contributor: a.contributor.key(),
        receipt: a.receipt.key(),
        amount,
        tokens,
        holding_tokens,
    };
    emit_cpi!(event);
    Ok(())
}

#[event_cpi]
#[derive(Accounts)]
pub struct SettleWork<'info> {
    #[account(
        mut,
        constraint = asset.status == AssetStatus::Live @ CachainError::AssetNotLive,
        has_one = ownership_mint @ CachainError::WrongMint,
        has_one = profit_mint @ CachainError::WrongMint,
    )]
    pub asset: Box<Account<'info, Asset>>,
    #[account(
        mut,
        has_one = asset,
        has_one = claimant @ CachainError::NotClaimant,
        constraint = bounty.kind == BountyKind::Work @ CachainError::WrongBountyKind,
    )]
    pub bounty: Box<Account<'info, Bounty>>,
    /// CHECK: equals `bounty.claimant` (has_one above); receives the reward.
    pub claimant: UncheckedAccount<'info>,
    #[account(mut)]
    pub ownership_mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(mut)]
    pub profit_mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(mut, token::mint = ownership_mint, token::authority = claimant, token::token_program = token_program)]
    pub claimant_ownership: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(mut, token::mint = profit_mint, token::authority = claimant, token::token_program = token_program)]
    pub claimant_profit: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(
        mut,
        seeds = [POSITION_SEED, asset.key().as_ref(), claimant.key().as_ref()],
        bump = claimant_position.bump,
    )]
    pub claimant_position: Box<Account<'info, Position>>,
    #[account(
        mut,
        token::mint = ownership_mint,
        token::token_program = token_program,
        constraint = holding_ownership.owner == asset.holding @ CachainError::WrongHoldingAccount,
    )]
    pub holding_ownership: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(
        mut,
        token::mint = profit_mint,
        token::token_program = token_program,
        constraint = holding_profit.owner == asset.holding @ CachainError::WrongHoldingAccount,
    )]
    pub holding_profit: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(
        mut,
        seeds = [POSITION_SEED, asset.key().as_ref(), asset.holding.as_ref()],
        bump = holding_position.bump,
    )]
    pub holding_position: Box<Account<'info, Position>>,
    /// CHECK: the claimant's SAS attestation; verified in `sas::require_eligible`.
    pub attestation: UncheckedAccount<'info>,
    /// CHECK: must equal `asset.credential`; verified in `sas::require_eligible`.
    pub credential: UncheckedAccount<'info>,
    pub token_program: Program<'info, Token2022>,
}

/// Pays an accepted work bounty: mints exactly the curated reward to the claimant.
/// Permissionless, because the amount and recipient were fixed by the council already.
pub fn settle_work(mut ctx: Context<SettleWork>) -> Result<()> {
    let a = &mut ctx.accounts;
    require!(
        a.bounty.state == BountyState::Accepted,
        CachainError::InvalidBountyState
    );
    require_eligible(
        &a.attestation.to_account_info(),
        &a.credential.to_account_info(),
        &a.asset.credential,
        &a.asset.schema,
        &a.claimant.key(),
    )?;
    let reward = a.bounty.terms.reward;
    let accounts = Issue {
        token_program: a.token_program.to_account_info(),
        asset: a.asset.to_account_info(),
        ownership_mint: a.ownership_mint.to_account_info(),
        profit_mint: a.profit_mint.to_account_info(),
        member_ownership: &a.claimant_ownership,
        member_profit: &a.claimant_profit,
        holding_ownership: &a.holding_ownership,
        holding_profit: &a.holding_profit,
    };
    let holding_tokens = issue(
        &mut a.asset,
        accounts,
        &mut a.claimant_position,
        &mut a.holding_position,
        reward,
    )?;
    a.bounty.state = BountyState::Settled;
    a.bounty.minted = reward;
    let event = WorkSettled {
        bounty: a.bounty.key(),
        claimant: a.claimant.key(),
        tokens: reward,
        holding_tokens,
    };
    emit_cpi!(event);
    Ok(())
}
