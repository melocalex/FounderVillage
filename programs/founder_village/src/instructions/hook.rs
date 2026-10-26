//! Transfer hook of the profit mint. Token-2022 calls it on every transfer, and it moves the
//! distribution ledger with the tokens: income earned before the transfer stays with the
//! sender, income after it goes to the receiver. It cannot be called to fake a transfer.

use crate::{error::FounderVillageError, state::*};
use anchor_lang::prelude::*;
use anchor_spl::{
    token_2022::{
        spl_token_2022::{
            extension::{
                transfer_hook::TransferHookAccount, BaseStateWithExtensions, StateWithExtensions,
            },
            state::Account as TokenAccountState,
        },
        ID as TOKEN_2022_ID,
    },
    token_interface::{Mint, TokenAccount},
};

#[derive(Accounts)]
pub struct Execute<'info> {
    #[account(token::mint = mint, token::token_program = TOKEN_2022_ID)]
    pub source: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(mint::token_program = TOKEN_2022_ID)]
    pub mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(token::mint = mint, token::token_program = TOKEN_2022_ID)]
    pub destination: Box<InterfaceAccount<'info, TokenAccount>>,
    /// CHECK: owner or delegate of `source`; Token-2022 checked its signature before calling.
    pub authority: UncheckedAccount<'info>,
    /// CHECK: the account list Token-2022 resolved the extra accounts from.
    #[account(seeds = [EXTRA_METAS_SEED, mint.key().as_ref()], bump)]
    pub extra_metas: UncheckedAccount<'info>,
    #[account(constraint = asset.profit_mint == mint.key() @ FounderVillageError::WrongMint)]
    pub asset: Box<Account<'info, Asset>>,
    #[account(
        mut,
        seeds = [POSITION_SEED, asset.key().as_ref(), source.owner.as_ref()],
        bump = source_position.bump,
    )]
    pub source_position: Box<Account<'info, Position>>,
    /// Same account as `source_position` when an owner moves tokens between its own accounts.
    #[account(
        mut,
        dup,
        seeds = [POSITION_SEED, asset.key().as_ref(), destination.owner.as_ref()],
        bump = destination_position.bump,
    )]
    pub destination_position: Box<Account<'info, Position>>,
}

fn require_transferring(account: &AccountInfo) -> Result<()> {
    let data = account.try_borrow_data()?;
    let state = StateWithExtensions::<TokenAccountState>::unpack(&data)?;
    let extension = state.get_extension::<TransferHookAccount>()?;
    require!(
        bool::from(extension.transferring),
        FounderVillageError::NotTransferring
    );
    Ok(())
}

pub fn execute(mut ctx: Context<Execute>, amount: u64) -> Result<()> {
    let a = &mut ctx.accounts;
    // Token-2022 sets `transferring` on both accounts only for the duration of a real transfer.
    require_transferring(&a.source.to_account_info())?;
    require_transferring(&a.destination.to_account_info())?;
    if a.source.owner == a.destination.owner {
        return Ok(());
    }
    let index = a.asset.distribution.reward_index;
    a.source_position.debit(index, amount)?;
    a.destination_position.credit(index, amount)?;
    Ok(())
}
