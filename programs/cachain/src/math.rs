//! Pure arithmetic. Every function rounds down, which keeps the remainder with the protocol:
//! members never receive more tokens or income than the exact rational amount.

use crate::{error::CachainError, state::BPS_DENOMINATOR};
use anchor_lang::prelude::*;

/// Fixed-point scale of `Distribution::reward_index`.
pub const INDEX_SCALE: u128 = 1_000_000_000_000;

/// Asset tokens bought by `amount` contribution units at `price_num / price_den`.
pub fn tokens_for(amount: u64, price_num: u64, price_den: u64) -> Result<u64> {
    require!(price_den > 0, CachainError::InvalidPrice);
    let tokens = u128::from(amount)
        .checked_mul(u128::from(price_num))
        .ok_or(CachainError::MathOverflow)?
        / u128::from(price_den);
    u64::try_from(tokens).map_err(|_| error!(CachainError::MathOverflow))
}

/// Tokens minted to the holding alongside `member_tokens`, so that the holding ends up with
/// `holding_bps` of the issuance: holding / (member + holding) = bps / 10_000.
pub fn holding_share(member_tokens: u64, holding_bps: u16) -> Result<u64> {
    require!(
        holding_bps < BPS_DENOMINATOR,
        CachainError::InvalidHoldingBps
    );
    let share = u128::from(member_tokens)
        .checked_mul(u128::from(holding_bps))
        .ok_or(CachainError::MathOverflow)?
        / u128::from(BPS_DENOMINATOR - holding_bps);
    u64::try_from(share).map_err(|_| error!(CachainError::MathOverflow))
}

/// Index increase from distributing `amount` over `supply` tracked profit tokens.
pub fn index_increment(amount: u64, supply: u64) -> Result<u128> {
    require!(supply > 0, CachainError::MathOverflow);
    Ok(u128::from(amount)
        .checked_mul(INDEX_SCALE)
        .ok_or(CachainError::MathOverflow)?
        / u128::from(supply))
}

/// Income earned by `balance` tokens while the index moved from `from` to `to`.
pub fn accrued(balance: u64, from: u128, to: u128) -> Result<u64> {
    let delta = to.checked_sub(from).ok_or(CachainError::MathOverflow)?;
    let earned = u128::from(balance)
        .checked_mul(delta)
        .ok_or(CachainError::MathOverflow)?
        / INDEX_SCALE;
    u64::try_from(earned).map_err(|_| error!(CachainError::MathOverflow))
}

#[cfg(test)]
mod tests {
    use super::*;
    use proptest::prelude::*;

    #[test]
    fn holding_gets_its_share_of_the_issuance() {
        // 20%: a member buying 800 leaves the holding 200 of 1000.
        assert_eq!(holding_share(800, 2_000).unwrap(), 200);
        assert_eq!(holding_share(0, 2_000).unwrap(), 0);
        assert!(holding_share(1, 10_000).is_err());
    }

    #[test]
    fn price_rounds_down() {
        assert_eq!(tokens_for(10, 1, 3).unwrap(), 3);
        assert_eq!(tokens_for(1_000_000, 1, 1).unwrap(), 1_000_000);
        assert!(tokens_for(1, 1, 0).is_err());
        assert!(tokens_for(u64::MAX, u64::MAX, 1).is_err());
    }

    proptest! {
        /// The holding never exceeds its share, and misses it by less than one base unit.
        #[test]
        fn holding_ratio_holds(member in 0u64..=u64::MAX / 10_000, bps in 0u16..9_999) {
            let holding = holding_share(member, bps).unwrap();
            let total = u128::from(member) + u128::from(holding);
            let exact = total * u128::from(bps);
            let actual = u128::from(holding) * u128::from(BPS_DENOMINATOR);
            prop_assert!(actual <= exact);
            prop_assert!(exact - actual < u128::from(BPS_DENOMINATOR));
        }

        /// Splitting an inflow across holders never pays out more than the inflow.
        #[test]
        fn distribution_never_exceeds_inflow(
            balances in proptest::collection::vec(1u64..1_000_000_000_000, 1..20),
            amount in 0u64..1_000_000_000_000_000,
        ) {
            let supply: u64 = balances.iter().sum();
            let index = index_increment(amount, supply).unwrap();
            let paid: u128 = balances
                .iter()
                .map(|b| u128::from(accrued(*b, 0, index).unwrap()))
                .sum();
            prop_assert!(paid <= u128::from(amount));
        }

        /// Accruing in two steps never pays more than accruing once.
        #[test]
        fn accrual_is_not_inflated_by_splitting(
            balance in 0u64..1_000_000_000_000,
            a in 0u128..1_000_000_000_000_000_000,
            b in 0u128..1_000_000_000_000_000_000,
        ) {
            let once = accrued(balance, 0, a + b).unwrap();
            let twice = accrued(balance, 0, a).unwrap() + accrued(balance, a, a + b).unwrap();
            prop_assert!(twice <= once);
        }
    }
}
