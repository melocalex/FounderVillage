use crate::{
    error::CachainError,
    events::{AssetCreated, AssetLive},
    state::*,
    token::{create_asset_mint, create_extra_metas, TokenMeta},
};
use anchor_lang::prelude::*;
use anchor_spl::{
    token_2022::Token2022,
    token_interface::{Mint, TokenAccount, TokenInterface},
};

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct CreateAssetArgs {
    pub asset_id: u64,
    pub council: Pubkey,
    pub holding: Pubkey,
    pub holding_bps: u16,
    pub decimals: u8,
    pub credential: Pubkey,
    pub schema: Pubkey,
}

#[event_cpi]
#[derive(Accounts)]
#[instruction(args: CreateAssetArgs)]
pub struct CreateAsset<'info> {
    #[account(mut)]
    pub creator: Signer<'info>,
    #[account(
        init,
        payer = creator,
        space = 8 + Asset::INIT_SPACE,
        seeds = [ASSET_SEED, creator.key().as_ref(), &args.asset_id.to_le_bytes()],
        bump,
    )]
    pub asset: Box<Account<'info, Asset>>,
    #[account(mint::token_program = contribution_token_program)]
    pub contribution_mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(
        token::mint = contribution_mint,
        token::token_program = contribution_token_program,
    )]
    pub spe_treasury: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(
        init,
        payer = creator,
        seeds = [CAPITAL_VAULT_SEED, asset.key().as_ref()],
        bump,
        token::mint = contribution_mint,
        token::authority = asset,
        token::token_program = contribution_token_program,
    )]
    pub capital_vault: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(
        init,
        payer = creator,
        seeds = [INCOME_VAULT_SEED, asset.key().as_ref()],
        bump,
        token::mint = contribution_mint,
        token::authority = asset,
        token::token_program = contribution_token_program,
    )]
    pub income_vault: Box<InterfaceAccount<'info, TokenAccount>>,
    pub contribution_token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}

pub fn create_asset(ctx: Context<CreateAsset>, args: CreateAssetArgs) -> Result<()> {
    require!(
        args.holding_bps < BPS_DENOMINATOR,
        CachainError::InvalidHoldingBps
    );
    let asset = &mut ctx.accounts.asset;
    asset.set_inner(Asset {
        creator: ctx.accounts.creator.key(),
        asset_id: args.asset_id,
        bump: ctx.bumps.asset,
        status: AssetStatus::Created,
        council: args.council,
        holding: args.holding,
        spe_treasury: ctx.accounts.spe_treasury.key(),
        contribution_mint: ctx.accounts.contribution_mint.key(),
        contribution_token_program: ctx.accounts.contribution_token_program.key(),
        capital_vault: ctx.accounts.capital_vault.key(),
        income_vault: ctx.accounts.income_vault.key(),
        ownership_mint: Pubkey::default(),
        profit_mint: Pubkey::default(),
        credential: args.credential,
        schema: args.schema,
        holding_bps: args.holding_bps,
        decimals: args.decimals,
        next_bounty_id: 0,
        ledger: Ledger::default(),
        distribution: Distribution::default(),
    });
    emit_cpi!(AssetCreated {
        asset: asset.key(),
        council: args.council,
        holding: args.holding,
        holding_bps: args.holding_bps,
    });
    Ok(())
}

#[event_cpi]
#[derive(Accounts)]
pub struct CreateMints<'info> {
    #[account(mut)]
    pub creator: Signer<'info>,
    #[account(
        mut,
        has_one = creator,
        constraint = asset.status == AssetStatus::Created @ CachainError::AssetAlreadyLive,
    )]
    pub asset: Box<Account<'info, Asset>>,
    /// CHECK: created here as a Token-2022 mint at this PDA.
    #[account(mut, seeds = [MINT_SEED, asset.key().as_ref(), &MintKind::Ownership.seed()], bump)]
    pub ownership_mint: UncheckedAccount<'info>,
    /// CHECK: created here as a Token-2022 mint at this PDA.
    #[account(mut, seeds = [MINT_SEED, asset.key().as_ref(), &MintKind::Profit.seed()], bump)]
    pub profit_mint: UncheckedAccount<'info>,
    /// CHECK: created here as the profit mint's transfer-hook account list at this PDA.
    #[account(mut, seeds = [EXTRA_METAS_SEED, profit_mint.key().as_ref()], bump)]
    pub extra_metas: UncheckedAccount<'info>,
    pub token_program: Program<'info, Token2022>,
    pub system_program: Program<'info, System>,
}

pub fn create_mints(
    ctx: Context<CreateMints>,
    ownership: TokenMeta,
    profit: TokenMeta,
) -> Result<()> {
    let accounts = &ctx.accounts;
    let asset_key = accounts.asset.key();
    let id = accounts.asset.asset_id.to_le_bytes();
    let asset_bump = [accounts.asset.bump];
    let asset_seeds: &[&[u8]] = &[
        ASSET_SEED,
        accounts.asset.creator.as_ref(),
        &id,
        &asset_bump,
    ];
    let payer = accounts.creator.to_account_info();
    let asset_info = accounts.asset.to_account_info();
    let token_program = accounts.token_program.to_account_info();

    for (kind, mint, bump, meta) in [
        (
            MintKind::Ownership,
            &accounts.ownership_mint,
            ctx.bumps.ownership_mint,
            &ownership,
        ),
        (
            MintKind::Profit,
            &accounts.profit_mint,
            ctx.bumps.profit_mint,
            &profit,
        ),
    ] {
        let kind_seed = kind.seed();
        let bump_seed = [bump];
        let mint_seeds: &[&[u8]] = &[MINT_SEED, asset_key.as_ref(), &kind_seed, &bump_seed];
        create_asset_mint(
            &payer,
            &mint.to_account_info(),
            &asset_info,
            &token_program,
            kind,
            accounts.asset.decimals,
            meta,
            &[mint_seeds],
            &[asset_seeds],
        )?;
    }

    let profit_key = accounts.profit_mint.key();
    let metas_bump = [ctx.bumps.extra_metas];
    let metas_seeds: &[&[u8]] = &[EXTRA_METAS_SEED, profit_key.as_ref(), &metas_bump];
    create_extra_metas(
        &payer,
        &accounts.extra_metas.to_account_info(),
        &asset_key,
        &[metas_seeds],
    )?;

    let asset = &mut ctx.accounts.asset;
    asset.ownership_mint = ctx.accounts.ownership_mint.key();
    asset.profit_mint = profit_key;
    asset.status = AssetStatus::Live;
    emit_cpi!(AssetLive {
        asset: asset_key,
        ownership_mint: asset.ownership_mint,
        profit_mint: asset.profit_mint,
    });
    Ok(())
}
