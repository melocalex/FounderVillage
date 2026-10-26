// Issuing the attestations the eligibility gate reads. An attestation carries a hash of the
// off-chain KYC or accreditation record and a tier, never the record itself: no names,
// documents or wallet-to-identity mappings go on-chain.
import type { Address, TransactionSigner } from '@solana/kit';
import {
  findAttestationPda,
  findCredentialPda,
  findSchemaPda,
  getCloseAttestationInstruction,
  getCreateAttestationInstruction,
  getCreateCredentialInstruction,
  getCreateSchemaInstruction,
  findEventAuthorityPda,
  SchemaDataType,
  SOLANA_ATTESTATION_SERVICE_PROGRAM_ADDRESS,
} from '@solana/attestation';

export const MEMBER_SCHEMA = {
  name: 'cachain-member',
  description: 'Founder Village member eligibility: hash of the off-chain record and a tier',
  layout: [SchemaDataType.VecU8, SchemaDataType.U8],
  fieldNames: ['claim_hash', 'tier'],
  version: 1,
} as const;

export async function issuerAddresses(issuer: Address, credentialName: string) {
  const [credential] = await findCredentialPda({ authority: issuer, name: credentialName });
  const [schema] = await findSchemaPda({ credential, name: MEMBER_SCHEMA.name, version: MEMBER_SCHEMA.version });
  return { credential, schema };
}

/** Credential with its authorized signers, and the member schema under it. */
export async function setupIssuerInstructions(
  payer: TransactionSigner,
  issuer: TransactionSigner,
  credentialName: string,
  signers: Address[],
) {
  const { credential, schema } = await issuerAddresses(issuer.address, credentialName);
  return {
    credential,
    schema,
    instructions: [
      getCreateCredentialInstruction({ payer, credential, authority: issuer, name: credentialName, signers }),
      getCreateSchemaInstruction({
        payer,
        authority: issuer,
        credential,
        schema,
        name: MEMBER_SCHEMA.name,
        description: MEMBER_SCHEMA.description,
        layout: [...MEMBER_SCHEMA.layout],
        fieldNames: [...MEMBER_SCHEMA.fieldNames],
      }),
    ],
  };
}

/** Attestation data for the member schema: Vec<u8> claim hash, then the tier byte. */
export function memberData(claimHash: Uint8Array, tier: number): Uint8Array {
  const out = new Uint8Array(4 + claimHash.length + 1);
  new DataView(out.buffer).setUint32(0, claimHash.length, true);
  out.set(claimHash, 4);
  out[4 + claimHash.length] = tier;
  return out;
}

/** Attests `holder`. `expiry` is unix seconds; 0 never expires. */
export async function attestInstruction(
  payer: TransactionSigner,
  signer: TransactionSigner,
  credential: Address,
  schema: Address,
  holder: Address,
  claimHash: Uint8Array,
  expiry: bigint,
) {
  const [attestation] = await findAttestationPda({ credential, schema, nonce: holder });
  return getCreateAttestationInstruction({
    payer,
    authority: signer,
    credential,
    schema,
    attestation,
    nonce: holder,
    data: memberData(claimHash, 1),
    expiry,
  });
}

/** Revokes `holder`. Their tokens can then be frozen by anyone through `freeze_holder`. */
export async function revokeInstruction(
  payer: TransactionSigner,
  signer: TransactionSigner,
  credential: Address,
  schema: Address,
  holder: Address,
) {
  const [attestation] = await findAttestationPda({ credential, schema, nonce: holder });
  const [eventAuthority] = await findEventAuthorityPda();
  return getCloseAttestationInstruction({
    payer,
    authority: signer,
    credential,
    attestation,
    eventAuthority,
    attestationProgram: SOLANA_ATTESTATION_SERVICE_PROGRAM_ADDRESS,
  });
}
