use anchor_lang::prelude::*;

#[error_code]
pub enum FounderVillageError {
    #[msg("Only the asset council may perform this action")]
    NotCouncil,
    #[msg("The asset is not live yet")]
    AssetNotLive,
    #[msg("The asset mints already exist")]
    AssetAlreadyLive,
    #[msg("Holding share must be below 100%")]
    InvalidHoldingBps,
    #[msg("Name, symbol or URI is too long")]
    MetadataTooLong,
    #[msg("Title is empty or longer than 64 bytes")]
    InvalidTitle,
    #[msg("Mint does not belong to this asset")]
    WrongMint,
    #[msg("Token account does not belong to the asset holding")]
    WrongHoldingAccount,
    #[msg("Position does not belong to this holder")]
    WrongPosition,
    #[msg("Attestation account is not the one derived for this holder")]
    WrongAttestationAddress,
    #[msg("Attestation is not owned by the Solana Attestation Service")]
    AttestationWrongOwner,
    #[msg("Attestation data is malformed")]
    AttestationMalformed,
    #[msg("Attestation was issued under another credential")]
    AttestationWrongCredential,
    #[msg("Attestation was issued under another schema")]
    AttestationWrongSchema,
    #[msg("Attestation names another wallet")]
    AttestationWrongSubject,
    #[msg("Attestation has expired")]
    AttestationExpired,
    #[msg("Holder has no valid attestation")]
    NotEligible,
    #[msg("Holder still holds a valid attestation")]
    StillEligible,
    #[msg("Token account is already thawed")]
    AlreadyThawed,
    #[msg("Token account is already frozen")]
    AlreadyFrozen,
    #[msg("Token account is frozen; thaw it through the eligibility gate first")]
    HolderFrozen,
    #[msg("Bounty is not in the state this action requires")]
    InvalidBountyState,
    #[msg("Action does not apply to this kind of bounty")]
    WrongBountyKind,
    #[msg("Work bounty reward must be positive")]
    InvalidReward,
    #[msg("Financial bounty price must have a positive numerator and denominator")]
    InvalidPrice,
    #[msg("Financial bounty target must be positive")]
    InvalidTarget,
    #[msg("Deadline is already in the past")]
    InvalidDeadline,
    #[msg("Contribution must be positive")]
    ZeroAmount,
    #[msg("Contribution exceeds what remains of the bounty target")]
    ExceedsTarget,
    #[msg("Contribution deadline has passed")]
    DeadlinePassed,
    #[msg("Contribution buys zero tokens at this price")]
    ZeroTokens,
    #[msg("A financial bounty that has raised capital cannot be cancelled; close funding instead")]
    FundsRaised,
    #[msg("Only the member who claimed the bounty may deliver it")]
    NotClaimant,
    #[msg("Delivery hash must not be empty")]
    EmptyDelivery,
    #[msg("Nothing to claim")]
    NothingToClaim,
    #[msg("Amount exceeds the recorded capital in the vault")]
    ExceedsCapital,
    #[msg("Outflow destination is not the SPE treasury")]
    WrongTreasury,
    #[msg("Vault is not this asset's vault")]
    WrongVault,
    #[msg("Arithmetic overflow")]
    MathOverflow,
    #[msg("Transfer hook was called outside of a transfer")]
    NotTransferring,
    #[msg("Token account owner can be reassigned; use an associated token account")]
    MutableOwner,
    #[msg("Nobody holds profit tokens yet; record income after the first issuance")]
    NoHolders,
}
