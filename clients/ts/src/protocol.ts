// Account resolution and instruction builders on top of the generated client. Every
// instruction still comes from the generated builders; this file only fills in the accounts a
// caller would otherwise have to derive by hand.
import {
  getAddressEncoder,
  getProgramDerivedAddress,
  getU64Encoder,
  type Address,
  type GetAccountInfoApi,
  type GetMultipleAccountsApi,
  type Instruction,
  type Rpc,
  type TransactionSigner,
} from '@solana/kit';
import {
  AccountState,
  fetchMaybeToken,
  findAssociatedTokenPda,
  getCreateAssociatedTokenIdempotentInstructionAsync,
  TOKEN_2022_PROGRAM_ADDRESS,
} from '@solana-program/token-2022';
import { findAttestationPda } from '@solana/attestation';
import { revokeInstruction } from './attestations';
import {
  CACHAIN_PROGRAM_ADDRESS,
  fetchAsset,
  fetchMaybePosition,
  findPositionPda,
  getClaimBountyInstructionAsync,
  getClaimDistributionInstructionAsync,
  getContributeInstructionAsync,
  getOpenPositionInstructionAsync,
  getProposeBountyInstructionAsync,
  getRecordInflowInstructionAsync,
  getSettleWorkInstructionAsync,
  getThawHolderInstructionAsync,
  getFreezeHolderInstructionAsync,
  type Asset,
  type BountyKind,
} from './generated/cachain';

type ReadRpc = Rpc<GetAccountInfoApi & GetMultipleAccountsApi>;

export type LoadedAsset = { address: Address; data: Asset };

const u64 = (n: bigint) => getU64Encoder().encode(n);
const addr = (a: Address) => getAddressEncoder().encode(a);
const text = (s: string) => new TextEncoder().encode(s);

export async function findAssetPda(creator: Address, assetId: bigint): Promise<Address> {
  const [pda] = await getProgramDerivedAddress({
    programAddress: CACHAIN_PROGRAM_ADDRESS,
    seeds: [text('asset'), addr(creator), u64(assetId)],
  });
  return pda;
}

export async function findBountyPda(asset: Address, id: bigint): Promise<Address> {
  const [pda] = await getProgramDerivedAddress({
    programAddress: CACHAIN_PROGRAM_ADDRESS,
    seeds: [text('bounty'), addr(asset), u64(id)],
  });
  return pda;
}

export async function loadAsset(rpc: ReadRpc, address: Address): Promise<LoadedAsset> {
  const account = await fetchAsset(rpc, address);
  return { address, data: account.data };
}

/** Every account that belongs to one holder of one asset. */
export async function holderAccounts(asset: LoadedAsset, owner: Address) {
  const ata = async (mint: Address) =>
    (await findAssociatedTokenPda({ owner, mint, tokenProgram: TOKEN_2022_PROGRAM_ADDRESS }))[0];
  const funds = (
    await findAssociatedTokenPda({
      owner,
      mint: asset.data.contributionMint,
      tokenProgram: asset.data.contributionTokenProgram,
    })
  )[0];
  const [position] = await findPositionPda({ asset: asset.address, owner });
  const [attestation] = await findAttestationPda({
    credential: asset.data.credential,
    schema: asset.data.schema,
    nonce: owner,
  });
  return {
    owner,
    ownership: await ata(asset.data.ownershipMint),
    profit: await ata(asset.data.profitMint),
    funds,
    position,
    attestation,
  };
}

export type HolderAccounts = Awaited<ReturnType<typeof holderAccounts>>;

/**
 * What it takes for `owner` to hold the asset: both token accounts, a distribution position,
 * and a thaw of each account through the eligibility gate. Returns only the steps still missing,
 * so it is safe to call again.
 */
export async function joinInstructions(
  rpc: ReadRpc,
  asset: LoadedAsset,
  owner: Address,
  payer: TransactionSigner,
): Promise<Instruction[]> {
  const h = await holderAccounts(asset, owner);
  const out: Instruction[] = [];
  for (const [mint, account] of [
    [asset.data.ownershipMint, h.ownership],
    [asset.data.profitMint, h.profit],
  ] as const) {
    const existing = await fetchMaybeToken(rpc, account);
    if (!existing.exists) {
      out.push(
        await getCreateAssociatedTokenIdempotentInstructionAsync({
          payer,
          owner,
          mint,
          tokenProgram: TOKEN_2022_PROGRAM_ADDRESS,
        }),
      );
    }
    if (!existing.exists || existing.data.state === AccountState.Frozen) {
      out.push(
        await getThawHolderInstructionAsync({
          asset: asset.address,
          owner,
          mint,
          tokenAccount: account,
          attestation: h.attestation,
          credential: asset.data.credential,
        }),
      );
    }
  }
  const position = await fetchMaybePosition(rpc, h.position);
  if (!position.exists) {
    // Opening the position first keeps the thaw order irrelevant to the hook.
    out.unshift(await getOpenPositionInstructionAsync({ payer, asset: asset.address, owner }));
  }
  return out;
}

/** Freezes both of a holder's accounts after their attestation is gone. Anyone may send it. */
export async function freezeInstructions(asset: LoadedAsset, owner: Address): Promise<Instruction[]> {
  const h = await holderAccounts(asset, owner);
  return Promise.all(
    [
      [asset.data.ownershipMint, h.ownership],
      [asset.data.profitMint, h.profit],
    ].map(([mint, tokenAccount]) =>
      getFreezeHolderInstructionAsync({
        asset: asset.address,
        owner,
        mint: mint as Address,
        tokenAccount: tokenAccount as Address,
        attestation: h.attestation,
        credential: asset.data.credential,
      }),
    ),
  );
}

/**
 * Revokes a holder's attestation and freezes both of their accounts in one transaction, so
 * there is no moment in which a revoked holder can still move tokens. Signed by the issuer.
 */
export async function revokeAndFreezeInstructions(
  asset: LoadedAsset,
  payer: TransactionSigner,
  issuer: TransactionSigner,
  owner: Address,
): Promise<Instruction[]> {
  return [
    await revokeInstruction(payer, issuer, asset.data.credential, asset.data.schema, owner),
    ...(await freezeInstructions(asset, owner)),
  ];
}

export async function proposeInstruction(
  asset: LoadedAsset,
  proposer: TransactionSigner,
  kind: BountyKind,
  title: string,
  specHash: Uint8Array,
) {
  const h = await holderAccounts(asset, proposer.address);
  return getProposeBountyInstructionAsync({
    proposer,
    asset: asset.address,
    bounty: await findBountyPda(asset.address, asset.data.nextBountyId),
    attestation: h.attestation,
    credential: asset.data.credential,
    kind,
    title,
    specHash,
  });
}

export async function contributeInstruction(
  asset: LoadedAsset,
  bounty: Address,
  contributor: TransactionSigner,
  amount: bigint,
  receiptId: bigint,
) {
  const c = await holderAccounts(asset, contributor.address);
  const holding = await holderAccounts(asset, asset.data.holding);
  return getContributeInstructionAsync({
    contributor,
    asset: asset.address,
    bounty,
    contributionMint: asset.data.contributionMint,
    contributorFunds: c.funds,
    capitalVault: asset.data.capitalVault,
    ownershipMint: asset.data.ownershipMint,
    profitMint: asset.data.profitMint,
    contributorOwnership: c.ownership,
    contributorProfit: c.profit,
    holdingOwnership: holding.ownership,
    holdingProfit: holding.profit,
    holdingPosition: holding.position,
    attestation: c.attestation,
    credential: asset.data.credential,
    contributionTokenProgram: asset.data.contributionTokenProgram,
    amount,
    receiptId,
  });
}

export async function claimBountyInstruction(asset: LoadedAsset, bounty: Address, claimant: TransactionSigner) {
  const c = await holderAccounts(asset, claimant.address);
  return getClaimBountyInstructionAsync({
    claimant,
    asset: asset.address,
    bounty,
    attestation: c.attestation,
    credential: asset.data.credential,
  });
}

export async function settleWorkInstruction(asset: LoadedAsset, bounty: Address, claimant: Address) {
  const c = await holderAccounts(asset, claimant);
  const holding = await holderAccounts(asset, asset.data.holding);
  return getSettleWorkInstructionAsync({
    asset: asset.address,
    bounty,
    claimant,
    ownershipMint: asset.data.ownershipMint,
    profitMint: asset.data.profitMint,
    claimantOwnership: c.ownership,
    claimantProfit: c.profit,
    holdingOwnership: holding.ownership,
    holdingProfit: holding.profit,
    holdingPosition: holding.position,
    attestation: c.attestation,
    credential: asset.data.credential,
  });
}

export async function recordInflowInstruction(asset: LoadedAsset, payer: TransactionSigner, amount: bigint) {
  const p = await holderAccounts(asset, payer.address);
  return getRecordInflowInstructionAsync({
    payer,
    asset: asset.address,
    contributionMint: asset.data.contributionMint,
    payerFunds: p.funds,
    incomeVault: asset.data.incomeVault,
    contributionTokenProgram: asset.data.contributionTokenProgram,
    amount,
  });
}

export async function claimDistributionInstruction(asset: LoadedAsset, owner: TransactionSigner) {
  const o = await holderAccounts(asset, owner.address);
  return getClaimDistributionInstructionAsync({
    owner,
    asset: asset.address,
    contributionMint: asset.data.contributionMint,
    ownerFunds: o.funds,
    incomeVault: asset.data.incomeVault,
    attestation: o.attestation,
    credential: asset.data.credential,
    contributionTokenProgram: asset.data.contributionTokenProgram,
  });
}
