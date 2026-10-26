//! Eligibility comes from the Solana Attestation Service (SAS), read directly from its accounts.
//!
//! SAS writes its accounts with a one-byte discriminator and Borsh-compatible fields
//! (solana-attestation-service `program/src/state/{credential,attestation}.rs`), so they are
//! parsed here by hand rather than pulled in through a client crate.
//!
//! Attestation: disc(1)=2 | nonce(32) | credential(32) | schema(32) | data(u32 len + bytes)
//!              | signer(32) | expiry(i64) | token_account(32)
//! Credential:  disc(1)=0 | authority(32) | name(u32 len + bytes) | signers(u32 count + 32*n)

use crate::error::CachainError;
use anchor_lang::prelude::*;

pub const SAS_PROGRAM_ID: Pubkey = pubkey!("22zoJMtdu4tQc2PzL74ZUT7FrwgB1Udec8DdW4yw4BdG");
pub const ATTESTATION_SEED: &[u8] = b"attestation";

const CREDENTIAL_DISCRIMINATOR: u8 = 0;
const ATTESTATION_DISCRIMINATOR: u8 = 2;

/// The attestation PDA SAS uses for `holder` under the pinned credential and schema.
/// The holder's wallet is the nonce, so one wallet has exactly one attestation address.
pub fn attestation_address(credential: &Pubkey, schema: &Pubkey, holder: &Pubkey) -> Pubkey {
    Pubkey::find_program_address(
        &[
            ATTESTATION_SEED,
            credential.as_ref(),
            schema.as_ref(),
            holder.as_ref(),
        ],
        &SAS_PROGRAM_ID,
    )
    .0
}

struct Reader<'a> {
    data: &'a [u8],
    at: usize,
}

impl<'a> Reader<'a> {
    fn take(&mut self, n: usize) -> Result<&'a [u8]> {
        let end = self
            .at
            .checked_add(n)
            .ok_or(CachainError::AttestationMalformed)?;
        let bytes = self
            .data
            .get(self.at..end)
            .ok_or(CachainError::AttestationMalformed)?;
        self.at = end;
        Ok(bytes)
    }
    fn u8(&mut self) -> Result<u8> {
        Ok(self.take(1)?[0])
    }
    fn u32(&mut self) -> Result<u32> {
        let b: [u8; 4] = self
            .take(4)?
            .try_into()
            .map_err(|_| CachainError::AttestationMalformed)?;
        Ok(u32::from_le_bytes(b))
    }
    fn i64(&mut self) -> Result<i64> {
        let b: [u8; 8] = self
            .take(8)?
            .try_into()
            .map_err(|_| CachainError::AttestationMalformed)?;
        Ok(i64::from_le_bytes(b))
    }
    fn pubkey(&mut self) -> Result<Pubkey> {
        let b: [u8; 32] = self
            .take(32)?
            .try_into()
            .map_err(|_| CachainError::AttestationMalformed)?;
        Ok(Pubkey::new_from_array(b))
    }
    fn bytes(&mut self) -> Result<&'a [u8]> {
        let len = usize::try_from(self.u32()?).map_err(|_| CachainError::AttestationMalformed)?;
        self.take(len)
    }
}

/// Why a holder is or is not eligible. Structural problems (wrong address, wrong credential
/// account, malformed data) are errors instead, because they mean the caller passed the wrong
/// accounts, not that the holder lost eligibility.
#[derive(Debug, PartialEq, Eq)]
pub enum Standing {
    Eligible,
    /// No attestation at the derived address: never issued, or closed by the issuer.
    Revoked,
    Expired,
    /// Issued by a signer the credential no longer authorizes.
    SignerRemoved,
}

/// Fails unless `attestation` is a live SAS attestation for `holder`, issued under the pinned
/// credential and schema by a signer the credential still authorizes.
pub fn require_eligible(
    attestation: &AccountInfo,
    credential: &AccountInfo,
    expected_credential: &Pubkey,
    expected_schema: &Pubkey,
    holder: &Pubkey,
) -> Result<()> {
    match standing(
        attestation,
        credential,
        expected_credential,
        expected_schema,
        holder,
    )? {
        Standing::Eligible => Ok(()),
        Standing::Expired => err!(CachainError::AttestationExpired),
        Standing::Revoked | Standing::SignerRemoved => err!(CachainError::NotEligible),
    }
}

/// Reads the holder's standing. The attestation address is re-derived from the pinned
/// credential and schema with the holder as nonce, so an attacker cannot pass an unrelated
/// (empty or foreign) account to make a holder look revoked or eligible.
pub fn standing(
    attestation: &AccountInfo,
    credential: &AccountInfo,
    expected_credential: &Pubkey,
    expected_schema: &Pubkey,
    holder: &Pubkey,
) -> Result<Standing> {
    require_keys_eq!(
        attestation.key(),
        attestation_address(expected_credential, expected_schema, holder),
        CachainError::WrongAttestationAddress
    );
    require_keys_eq!(
        credential.key(),
        *expected_credential,
        CachainError::AttestationWrongCredential
    );
    require_keys_eq!(
        *credential.owner,
        SAS_PROGRAM_ID,
        CachainError::AttestationWrongOwner
    );
    // A closed attestation leaves a system-owned empty account at the same address.
    if attestation.data_is_empty() {
        return Ok(Standing::Revoked);
    }
    require_keys_eq!(
        *attestation.owner,
        SAS_PROGRAM_ID,
        CachainError::AttestationWrongOwner
    );

    let data = attestation.try_borrow_data()?;
    let mut r = Reader { data: &data, at: 0 };
    require!(
        r.u8()? == ATTESTATION_DISCRIMINATOR,
        CachainError::AttestationMalformed
    );
    let nonce = r.pubkey()?;
    let issued_credential = r.pubkey()?;
    let issued_schema = r.pubkey()?;
    r.bytes()?;
    let signer = r.pubkey()?;
    let expiry = r.i64()?;
    require_keys_eq!(nonce, *holder, CachainError::AttestationWrongSubject);
    require_keys_eq!(
        issued_credential,
        *expected_credential,
        CachainError::AttestationWrongCredential
    );
    require_keys_eq!(
        issued_schema,
        *expected_schema,
        CachainError::AttestationWrongSchema
    );
    if expiry != 0 && expiry <= Clock::get()?.unix_timestamp {
        return Ok(Standing::Expired);
    }

    // Removing a signer from the credential does not close what it signed, so check it here.
    let cred = credential.try_borrow_data()?;
    let mut c = Reader { data: &cred, at: 0 };
    require!(
        c.u8()? == CREDENTIAL_DISCRIMINATOR,
        CachainError::AttestationMalformed
    );
    c.pubkey()?;
    c.bytes()?;
    let signers = c.u32()?;
    for _ in 0..signers {
        if c.pubkey()? == signer {
            return Ok(Standing::Eligible);
        }
    }
    Ok(Standing::SignerRemoved)
}
