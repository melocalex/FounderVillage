// Council actions go through a Squads v4 multisig: the asset's council is the multisig's vault
// PDA, so a curation or acceptance needs a proposal, a threshold of approvals and an execute.
// Instruction builders are generated from the Squads IDL (idl/squads_multisig_program.json);
// only the compact `transaction_message` encoding below is written by hand, because the IDL
// declares it as opaque bytes (Squads v4 vault_transaction_create.rs, small_vec.rs).
import {
  AccountRole,
  getAddressEncoder,
  getProgramDerivedAddress,
  getU64Encoder,
  none,
  type AccountMeta,
  type Address,
  type GetAccountInfoApi,
  type Instruction,
  type ReadonlyUint8Array,
  type Rpc,
  type TransactionSigner,
} from '@solana/kit';
import {
  fetchMultisig,
  fetchProgramConfig,
  getMultisigCreateV2Instruction,
  getProposalApproveInstruction,
  getProposalCreateInstruction,
  getVaultTransactionCreateInstruction,
  getVaultTransactionExecuteInstruction,
  SQUADS_MULTISIG_PROGRAM_PROGRAM_ADDRESS as SQUADS,
} from './generated/squads';

export { SQUADS as SQUADS_PROGRAM_ADDRESS };

/** Initiate | Vote | Execute. */
export const ALL_PERMISSIONS = 7;

const text = (s: string) => new TextEncoder().encode(s);
const key = (a: Address) => getAddressEncoder().encode(a);

const pda = async (seeds: ReadonlyUint8Array[]) =>
  (await getProgramDerivedAddress({ programAddress: SQUADS, seeds }))[0];

export const findProgramConfigPda = () => pda([text('multisig'), text('program_config')]);
export const findMultisigPda = (createKey: Address) =>
  pda([text('multisig'), text('multisig'), key(createKey)]);
export const findVaultPda = (multisig: Address, index = 0) =>
  pda([text('multisig'), key(multisig), text('vault'), new Uint8Array([index])]);
export const findTransactionPda = (multisig: Address, index: bigint) =>
  pda([text('multisig'), key(multisig), text('transaction'), new Uint8Array(getU64Encoder().encode(index))]);
export const findProposalPda = (multisig: Address, index: bigint) =>
  pda([
    text('multisig'),
    key(multisig),
    text('transaction'),
    new Uint8Array(getU64Encoder().encode(index)),
    text('proposal'),
  ]);

/** A threshold-of-n multisig with no time lock and no config authority (autonomous). */
export async function createMultisigInstruction(
  rpc: Rpc<GetAccountInfoApi>,
  creator: TransactionSigner,
  createKey: TransactionSigner,
  members: Address[],
  threshold: number,
) {
  const programConfig = await findProgramConfigPda();
  const config = await fetchProgramConfig(rpc, programConfig);
  return getMultisigCreateV2Instruction({
    programConfig,
    treasury: config.data.treasury,
    multisig: await findMultisigPda(createKey.address),
    createKey,
    creator,
    configAuthority: none(),
    threshold,
    members: members.map((m) => ({ key: m, permissions: { mask: ALL_PERMISSIONS } })),
    timeLock: 0,
    rentCollector: none(),
    memo: none(),
  });
}

type Slot = { address: Address; signer: boolean; writable: boolean };

/**
 * Squads' compact message. Account keys are ordered writable signers, readonly signers,
 * writable non-signers, readonly non-signers; the vault comes first as the fee payer.
 */
export function compileVaultMessage(vault: Address, instructions: Instruction[]) {
  const slots = new Map<Address, Slot>([[vault, { address: vault, signer: true, writable: true }]]);
  const touch = (address: Address, signer: boolean, writable: boolean) => {
    const s = slots.get(address) ?? { address, signer: false, writable: false };
    s.signer ||= signer;
    s.writable ||= writable;
    slots.set(address, s);
  };
  for (const ix of instructions) {
    touch(ix.programAddress, false, false);
    for (const meta of ix.accounts ?? []) {
      const role = (meta as AccountMeta).role;
      touch(
        meta.address,
        role === AccountRole.READONLY_SIGNER || role === AccountRole.WRITABLE_SIGNER,
        role === AccountRole.WRITABLE || role === AccountRole.WRITABLE_SIGNER,
      );
    }
  }
  const rank = (s: Slot) => (s.signer ? (s.writable ? 0 : 1) : s.writable ? 2 : 3);
  const [first, ...rest] = [...slots.values()];
  const keys = [first!, ...rest.sort((a, b) => rank(a) - rank(b))];
  const index = new Map(keys.map((k, i) => [k.address, i]));

  const u8 = (n: number) => {
    if (n > 255) throw new Error('Squads message field exceeds u8');
    return Uint8Array.of(n);
  };
  const u16 = (n: number) => Uint8Array.of(n & 0xff, n >> 8);
  const parts: Uint8Array[] = [
    u8(keys.filter((k) => k.signer).length),
    u8(keys.filter((k) => k.signer && k.writable).length),
    u8(keys.filter((k) => !k.signer && k.writable).length),
    u8(keys.length),
    ...keys.map((k) => key(k.address) as Uint8Array),
    u8(instructions.length),
  ];
  for (const ix of instructions) {
    const accounts = ix.accounts ?? [];
    const data = ix.data ?? new Uint8Array();
    parts.push(
      u8(index.get(ix.programAddress)!),
      u8(accounts.length),
      Uint8Array.from(accounts.map((a) => index.get(a.address)!)),
      u16(data.length),
      Uint8Array.from(data),
    );
  }
  parts.push(u8(0)); // no address lookup tables
  const bytes = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    bytes.set(p, at);
    at += p.length;
  }
  return { bytes, keys };
}

/**
 * The three steps of a council action, each a separate transaction in practice:
 * propose (creates the vault transaction and an active proposal, and records the proposer's
 * approval), approve (one per remaining member up to the threshold), execute.
 */
export async function councilAction(
  rpc: Rpc<GetAccountInfoApi>,
  multisig: Address,
  instructions: Instruction[],
  proposer: TransactionSigner,
) {
  const vault = await findVaultPda(multisig);
  const { transactionIndex } = (await fetchMultisig(rpc, multisig)).data;
  const index = transactionIndex + 1n;
  const transaction = await findTransactionPda(multisig, index);
  const proposal = await findProposalPda(multisig, index);
  const { bytes, keys } = compileVaultMessage(vault, instructions);

  const approve = (member: TransactionSigner) =>
    getProposalApproveInstruction({ multisig, member, proposal, args: { memo: none() } });

  return {
    index,
    vault,
    proposal,
    propose: [
      getVaultTransactionCreateInstruction({
        multisig,
        transaction,
        creator: proposer,
        rentPayer: proposer,
        args: { vaultIndex: 0, ephemeralSigners: 0, transactionMessage: bytes, memo: none() },
      }),
      getProposalCreateInstruction({
        multisig,
        proposal,
        creator: proposer,
        rentPayer: proposer,
        transactionIndex: index,
        draft: false,
      }),
      approve(proposer),
    ] as Instruction[],
    approve,
    /** Executes once the threshold is met. The vault signs inside Squads, so it is passed as a plain account. */
    execute: (member: TransactionSigner): Instruction => {
      const ix = getVaultTransactionExecuteInstruction({ multisig, proposal, transaction, member });
      const remaining: AccountMeta[] = keys.map((k) => ({
        address: k.address,
        role: k.writable ? AccountRole.WRITABLE : AccountRole.READONLY,
      }));
      return { ...ix, accounts: [...ix.accounts, ...remaining] };
    },
  };
}
