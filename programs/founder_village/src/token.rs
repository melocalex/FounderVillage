//! Account creation and the Token-2022 mint recipe. Every extension is fixed when the mint is
//! created and cannot be added later, so the whole set is decided here.

use crate::{
    error::FounderVillageError,
    state::{Asset, MintKind, Position, MAX_NAME_LEN, MAX_SYMBOL_LEN, MAX_URI_LEN, POSITION_SEED},
};
use anchor_lang::{
    prelude::*,
    system_program::{self, Allocate, Assign, CreateAccount, Transfer},
};
use anchor_spl::{
    token_2022::spl_token_2022::{
        extension::ExtensionType,
        state::{AccountState, Mint as MintState},
    },
    token_2022_extensions::{
        default_account_state_initialize, metadata_pointer_initialize, transfer_hook_initialize,
        DefaultAccountStateInitialize, MetadataPointerInitialize, TransferHookInitialize,
    },
    token_interface::{
        initialize_mint2, mint_to, token_metadata_initialize, InitializeMint2, MintTo,
        TokenMetadataInitialize,
    },
};
use spl_tlv_account_resolution::{
    account::ExtraAccountMeta, seeds::Seed, state::ExtraAccountMetaList,
};
use spl_transfer_hook_interface::instruction::ExecuteInstruction;

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct TokenMeta {
    pub name: String,
    pub symbol: String,
    pub uri: String,
}

impl TokenMeta {
    pub fn validate(&self) -> Result<()> {
        require!(
            !self.name.is_empty()
                && self.name.len() <= MAX_NAME_LEN
                && !self.symbol.is_empty()
                && self.symbol.len() <= MAX_SYMBOL_LEN
                && self.uri.len() <= MAX_URI_LEN,
            FounderVillageError::MetadataTooLong
        );
        Ok(())
    }
}

/// Creates a PDA owned by `owner`, tolerating a target someone pre-funded with lamports
/// (a bare `create_account` would fail on it, letting anyone block initialization).
pub fn create_pda_account<'info>(
    payer: &AccountInfo<'info>,
    target: &AccountInfo<'info>,
    space: usize,
    owner: &Pubkey,
    signer_seeds: &[&[&[u8]]],
) -> Result<()> {
    let rent = Rent::get()?.minimum_balance(space);
    let space_u64 = u64::try_from(space).map_err(|_| FounderVillageError::MathOverflow)?;
    let current = target.lamports();
    if current == 0 {
        return system_program::create_account(
            CpiContext::new_with_signer(
                system_program::ID,
                CreateAccount {
                    from: payer.clone(),
                    to: target.clone(),
                },
                signer_seeds,
            ),
            rent,
            space_u64,
            owner,
        );
    }
    require_keys_eq!(
        *target.owner,
        system_program::ID,
        FounderVillageError::AssetAlreadyLive
    );
    require!(
        target.data_is_empty(),
        FounderVillageError::AssetAlreadyLive
    );
    let deficit = rent.saturating_sub(current);
    if deficit > 0 {
        system_program::transfer(
            CpiContext::new(
                system_program::ID,
                Transfer {
                    from: payer.clone(),
                    to: target.clone(),
                },
            ),
            deficit,
        )?;
    }
    system_program::allocate(
        CpiContext::new_with_signer(
            system_program::ID,
            Allocate {
                account_to_allocate: target.clone(),
            },
            signer_seeds,
        ),
        space_u64,
    )?;
    system_program::assign(
        CpiContext::new_with_signer(
            system_program::ID,
            Assign {
                account_to_assign: target.clone(),
            },
            signer_seeds,
        ),
        owner,
    )
}

/// Tops `account` up to the rent-exempt minimum for its current size.
pub fn top_up_rent<'info>(payer: &AccountInfo<'info>, account: &AccountInfo<'info>) -> Result<()> {
    let needed = Rent::get()?.minimum_balance(account.data_len());
    let deficit = needed.saturating_sub(account.lamports());
    if deficit > 0 {
        system_program::transfer(
            CpiContext::new(
                system_program::ID,
                Transfer {
                    from: payer.clone(),
                    to: account.clone(),
                },
            ),
            deficit,
        )?;
    }
    Ok(())
}

/// The Token-2022 mint every asset token uses:
/// - DefaultAccountState = Frozen: no account can hold the token until the eligibility gate
///   thaws it, so holding (not just buying) is gated on-chain.
/// - TransferHook, authority = asset: the profit mint points it at this program to keep the
///   distribution ledger exact; the ownership mint leaves it empty but keeps the extension so
///   per-transfer rules (lockups, tranche blackouts) can be added without a new mint.
/// - MetadataPointer to itself plus TokenMetadata, so wallets show a name.
///
/// Not enabled, on purpose: PermanentDelegate (forced transfers), MintCloseAuthority
/// (close-and-reinitialize), TransferFee. Mint and freeze authority are the asset PDA.
#[allow(clippy::too_many_arguments)]
pub fn create_asset_mint<'info>(
    payer: &AccountInfo<'info>,
    mint: &AccountInfo<'info>,
    asset: &AccountInfo<'info>,
    token_program: &AccountInfo<'info>,
    kind: MintKind,
    decimals: u8,
    meta: &TokenMeta,
    mint_seeds: &[&[&[u8]]],
    asset_seeds: &[&[&[u8]]],
) -> Result<()> {
    meta.validate()?;
    let space = ExtensionType::try_calculate_account_len::<MintState>(&[
        ExtensionType::DefaultAccountState,
        ExtensionType::TransferHook,
        ExtensionType::MetadataPointer,
    ])?;
    create_pda_account(payer, mint, space, &token_program.key(), mint_seeds)?;

    let program = token_program.key();
    default_account_state_initialize(
        CpiContext::new(
            program,
            DefaultAccountStateInitialize {
                token_program_id: token_program.clone(),
                mint: mint.clone(),
            },
        ),
        &AccountState::Frozen,
    )?;
    let hook_program = match kind {
        MintKind::Ownership => None,
        MintKind::Profit => Some(crate::ID),
    };
    transfer_hook_initialize(
        CpiContext::new(
            program,
            TransferHookInitialize {
                token_program_id: token_program.clone(),
                mint: mint.clone(),
            },
        ),
        Some(asset.key()),
        hook_program,
    )?;
    metadata_pointer_initialize(
        CpiContext::new(
            program,
            MetadataPointerInitialize {
                token_program_id: token_program.clone(),
                mint: mint.clone(),
            },
        ),
        Some(asset.key()),
        Some(mint.key()),
    )?;
    initialize_mint2(
        CpiContext::new(program, InitializeMint2 { mint: mint.clone() }),
        decimals,
        &asset.key(),
        Some(&asset.key()),
    )?;
    token_metadata_initialize(
        CpiContext::new_with_signer(
            program,
            TokenMetadataInitialize {
                program_id: token_program.clone(),
                mint: mint.clone(),
                metadata: mint.clone(),
                mint_authority: asset.clone(),
                update_authority: asset.clone(),
            },
            asset_seeds,
        ),
        meta.name.clone(),
        meta.symbol.clone(),
        meta.uri.clone(),
    )?;
    // Token metadata grew the mint; pay rent for the new size.
    top_up_rent(payer, mint)
}

/// Extra accounts Token-2022 passes to `execute` on every profit-token transfer:
/// 5 = the asset, 6 = the source owner's position, 7 = the destination owner's position.
/// Owners are read from bytes 32..64 of each token account, so a transfer can never settle
/// against a position the caller picked.
pub fn profit_hook_metas(asset: &Pubkey) -> Result<Vec<ExtraAccountMeta>> {
    let position_of = |token_account_index: u8| -> Result<ExtraAccountMeta> {
        Ok(ExtraAccountMeta::new_with_seeds(
            &[
                Seed::Literal {
                    bytes: POSITION_SEED.to_vec(),
                },
                Seed::AccountKey { index: 5 },
                Seed::AccountData {
                    account_index: token_account_index,
                    data_index: 32,
                    length: 32,
                },
            ],
            false,
            true,
        )?)
    };
    Ok(vec![
        ExtraAccountMeta::new_with_pubkey(asset, false, false)?,
        position_of(0)?,
        position_of(2)?,
    ])
}

pub fn create_extra_metas<'info>(
    payer: &AccountInfo<'info>,
    extra_metas: &AccountInfo<'info>,
    asset: &Pubkey,
    seeds: &[&[&[u8]]],
) -> Result<()> {
    let metas = profit_hook_metas(asset)?;
    let space = ExtraAccountMetaList::size_of(metas.len())?;
    create_pda_account(payer, extra_metas, space, &crate::ID, seeds)?;
    let mut data = extra_metas.try_borrow_mut_data()?;
    ExtraAccountMetaList::init::<ExecuteInstruction>(&mut data, &metas)?;
    Ok(())
}

/// Mints `amount` of an asset token, signed by the asset PDA.
pub fn mint_asset_token<'info>(
    token_program: &AccountInfo<'info>,
    mint: &AccountInfo<'info>,
    to: &AccountInfo<'info>,
    asset: &AccountInfo<'info>,
    asset_seeds: &[&[&[u8]]],
    amount: u64,
) -> Result<()> {
    if amount == 0 {
        return Ok(());
    }
    mint_to(
        CpiContext::new_with_signer(
            token_program.key(),
            MintTo {
                mint: mint.clone(),
                to: to.clone(),
                authority: asset.clone(),
            },
            asset_seeds,
        ),
        amount,
    )
}

impl Position {
    /// Moves `accrued` forward to `index` at the current balance.
    pub fn settle(&mut self, index: u128) -> Result<()> {
        let earned = crate::math::accrued(self.balance, self.index, index)?;
        self.accrued = self
            .accrued
            .checked_add(earned)
            .ok_or(FounderVillageError::MathOverflow)?;
        self.index = index;
        Ok(())
    }

    pub fn credit(&mut self, index: u128, amount: u64) -> Result<()> {
        self.settle(index)?;
        self.balance = self
            .balance
            .checked_add(amount)
            .ok_or(FounderVillageError::MathOverflow)?;
        Ok(())
    }

    pub fn debit(&mut self, index: u128, amount: u64) -> Result<()> {
        self.settle(index)?;
        self.balance = self
            .balance
            .checked_sub(amount)
            .ok_or(FounderVillageError::MathOverflow)?;
        Ok(())
    }
}

impl Asset {
    pub fn require_live(&self) -> Result<()> {
        require!(
            self.status == crate::state::AssetStatus::Live,
            FounderVillageError::AssetNotLive
        );
        Ok(())
    }

    pub fn mint_of(&self, kind: MintKind) -> Pubkey {
        match kind {
            MintKind::Ownership => self.ownership_mint,
            MintKind::Profit => self.profit_mint,
        }
    }

    pub fn kind_of(&self, mint: &Pubkey) -> Result<MintKind> {
        if *mint == self.ownership_mint {
            Ok(MintKind::Ownership)
        } else if *mint == self.profit_mint {
            Ok(MintKind::Profit)
        } else {
            err!(FounderVillageError::WrongMint)
        }
    }

    /// Adds `amount` of profit tokens to the tracked supply.
    pub fn track_profit(&mut self, amount: u64) -> Result<()> {
        self.distribution.tracked_supply = self
            .distribution
            .tracked_supply
            .checked_add(amount)
            .ok_or(FounderVillageError::MathOverflow)?;
        Ok(())
    }

    /// Spreads an inflow over current profit holders. Refused while nobody holds profit
    /// tokens, because the first minter would otherwise collect income recorded before them.
    pub fn distribute(&mut self, amount: u64) -> Result<()> {
        let (step, carry) = crate::math::spread(
            amount,
            self.distribution.carry,
            self.distribution.tracked_supply,
        )?;
        self.distribution.reward_index = self
            .distribution
            .reward_index
            .checked_add(step)
            .ok_or(FounderVillageError::MathOverflow)?;
        self.distribution.carry = carry;
        Ok(())
    }
}
