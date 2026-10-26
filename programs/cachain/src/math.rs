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

/// Spreads `amount` (plus the `carry` left by earlier inflows, already in index units) over
/// `supply` tracked profit tokens. Returns the index step and the new carry. The carry is what
/// the step could not represent, kept in index units so nothing is promised twice:
/// `amount * INDEX_SCALE + carry == step * supply + new_carry`, and `new_carry < supply`.
pub fn spread(amount: u64, carry: u64, supply: u64) -> Result<(u128, u64)> {
    require!(supply > 0, CachainError::NoHolders);
    let scaled = u128::from(amount)
        .checked_mul(INDEX_SCALE)
        .ok_or(CachainError::MathOverflow)?
        .checked_add(u128::from(carry))
        .ok_or(CachainError::MathOverflow)?;
    let supply = u128::from(supply);
    let carry = u64::try_from(scaled % supply).map_err(|_| error!(CachainError::MathOverflow))?;
    Ok((scaled / supply, carry))
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

    /// Regression: ten one-unit inflows over 10,000 / 5,000 / 3,750 tokens once promised 18
    /// units for 10 recorded, because the remainder was carried in whole units.
    #[test]
    fn tiny_inflows_promise_no_more_than_recorded() {
        let balances = [10_000_000_000u64, 5_000_000_000, 3_750_000_000];
        let supply = balances.iter().sum();
        let (mut index, mut carry) = (0u128, 0u64);
        for _ in 0..10 {
            let (step, next) = spread(1, carry, supply).unwrap();
            index += step;
            carry = next;
        }
        let paid: u64 = balances
            .iter()
            .map(|b| accrued(*b, 0, index).unwrap())
            .sum();
        assert!(paid <= 10);
        assert!(spread(1, 0, 0).is_err());
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

        /// Any sequence of inflows, however small, never promises holders more than came in,
        /// and the carry accounts for every unit that has not been promised yet.
        #[test]
        fn distribution_never_exceeds_inflows(
            balances in proptest::collection::vec(1u64..1_000_000_000_000, 1..20),
            amounts in proptest::collection::vec(0u64..1_000_000_000_000, 1..40),
        ) {
            let supply: u64 = balances.iter().sum();
            let (mut index, mut carry) = (0u128, 0u64);
            for amount in &amounts {
                let (step, next) = spread(*amount, carry, supply).unwrap();
                prop_assert!(u128::from(*amount) * INDEX_SCALE + u128::from(carry)
                    == step * u128::from(supply) + u128::from(next));
                prop_assert!(next < supply);
                index += step;
                carry = next;
            }
            let paid: u128 = balances.iter().map(|b| u128::from(accrued(*b, 0, index).unwrap())).sum();
            let total: u128 = amounts.iter().map(|a| u128::from(*a)).sum();
            prop_assert!(paid <= total);
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
