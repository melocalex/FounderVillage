// Everything the harness page does to the chain, kept apart from the markup. The production
// frontend should read this file for the sequence of calls, not for its UI.
import {
  AccountRole,
  createClient,
  type Address,
  type Instruction,
  type TransactionSigner,
} from '@solana/kit';
import { solanaRpc } from '@solana/kit-plugin-rpc';
import { signer } from '@solana/kit-plugin-signer';
import { fetchMaybeToken } from '@solana-program/token-2022';
import { fetchMaybeAttestation } from '@solana/attestation';
import {
  CACHAIN_PROGRAM_ADDRESS,
  describeError,
  fetchAsset,
  fetchBounty,
  fetchMaybePosition,
  findBountyPda,
  findCustomError,
  holderAccounts,
  identifyCachainInstruction,
  CachainInstruction,
  SQUADS_PROGRAM_ADDRESS,
  type LoadedAsset,
} from '../../clients/ts/src';

export type Localnet = {
  rpcUrl: string;
  wsUrl: string;
  asset: Address;
  multisig: Address;
  council: Address;
  bounties: { funding: Address; work: Address };
};

/** Genesis hashes of the public clusters. Demo keys must never sign against these. */
const PUBLIC_CLUSTERS: Record<string, string> = {
  '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d': 'mainnet-beta',
  EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG: 'devnet',
  '4uhcVJyU9pJkvQyS88uRDiswHXSCkY3zQawwpjk2NsNY': 'testnet',
};

export async function loadLocalnet(): Promise<Localnet> {
  const res = await fetch('/localnet.json');
  if (!res.ok) throw new Error('localnet.json not found: start the harness with `npm run dev`');
  return res.json();
}

export type Client = Awaited<ReturnType<typeof clientFor>>;

export function clientFor(net: Localnet, as: TransactionSigner) {
  return createClient()
    .use(signer(as))
    .use(solanaRpc({ rpcUrl: net.rpcUrl, rpcSubscriptionsUrl: net.wsUrl, transactionConfig: { version: 1 } }));
}

/** Refuses to continue when the RPC is a public cluster. */
export async function assertLocal(client: Client) {
  const genesis = await client.rpc.getGenesisHash().send();
  const cluster = PUBLIC_CLUSTERS[genesis];
  if (cluster) throw new Error(`RPC is ${cluster}: the harness's demo keys only sign on a local cluster`);
  return genesis;
}

const json = (value: unknown) =>
  JSON.parse(JSON.stringify(value, (_k, v) => (typeof v === 'bigint' ? v.toString() : v)));

export async function loadAssetState(client: Client, net: Localnet): Promise<LoadedAsset> {
  return { address: net.asset, data: (await fetchAsset(client.rpc, net.asset)).data };
}

/** Account data without the 8-byte discriminator, for display. */
export const plain = <T extends { discriminator?: unknown }>({ discriminator: _d, ...rest }: T) => rest;

export async function listBounties(client: Client, asset: LoadedAsset) {
  const out = [];
  for (let id = 0n; id < asset.data.nextBountyId; id++) {
    const address = await findBountyPda(asset.address, id);
    out.push({ address, ...plain((await fetchBounty(client.rpc, address)).data) });
  }
  return out;
}

/** What the chain says about one holder: attestation, token accounts, position. */
export async function holderView(client: Client, asset: LoadedAsset, owner: Address) {
  const h = await holderAccounts(asset, owner);
  const attestation = await fetchMaybeAttestation(client.rpc, h.attestation);
  const token = async (a: Address) => {
    const t = await fetchMaybeToken(client.rpc, a);
    return t.exists ? { address: a, state: ['uninitialized', 'thawed', 'frozen'][t.data.state], amount: t.data.amount } : { address: a, state: 'none' };
  };
  const position = await fetchMaybePosition(client.rpc, h.position);
  // Accrual is settled lazily on-chain; this is what claim_distribution would pay now.
  const claimable = position.exists
    ? position.data.accrued +
      (position.data.balance * (asset.data.distribution.rewardIndex - position.data.index)) / 1_000_000_000_000n
    : 0n;
  const { discriminator: _d, ...positionData } = position.exists ? position.data : { discriminator: undefined };
  return json({
    owner,
    attestation: attestation.exists
      ? { address: h.attestation, expiry: attestation.data.expiry, signer: attestation.data.signer }
      : { address: h.attestation, status: 'none (not whitelisted, or revoked)' },
    ownership: await token(h.ownership),
    profit: await token(h.profit),
    position: position.exists ? { address: h.position, ...positionData, claimableNow: claimable } : { address: h.position, status: 'none' },
  });
}

export type LogEntry = {
  label: string;
  signer: Address;
  instructions: { program: string; name: string; accounts: { address: Address; role: string }[] }[];
  signature?: string;
  explorer?: string;
  error?: { code?: number; name: string; message: string };
  before?: unknown;
  after?: unknown;
};

const ROLE = ['readonly', 'writable', 'readonly signer', 'writable signer'];

export function describe(ix: Instruction) {
  let name = '';
  if (ix.programAddress === CACHAIN_PROGRAM_ADDRESS) {
    try {
      name = CachainInstruction[identifyCachainInstruction(ix as Instruction & { data: Uint8Array })];
    } catch {
      name = 'unknown';
    }
  }
  const program =
    ix.programAddress === CACHAIN_PROGRAM_ADDRESS ? 'cachain' : ix.programAddress === SQUADS_PROGRAM_ADDRESS ? 'squads' : ix.programAddress;
  return {
    program,
    name,
    accounts: (ix.accounts ?? []).map((a) => ({ address: a.address, role: ROLE[a.role as AccountRole] ?? String(a.role) })),
  };
}

/** Sends `instructions` as `as`, recording state before and after and any program error. */
export async function run(
  net: Localnet,
  as: TransactionSigner,
  label: string,
  instructions: Instruction[],
  observe: () => Promise<unknown>,
): Promise<LogEntry> {
  const entry: LogEntry = { label, signer: as.address, instructions: instructions.map(describe), before: await observe() };
  try {
    const result = await clientFor(net, as).sendTransaction(instructions);
    entry.signature = String(result.context.signature);
    entry.explorer = `https://explorer.solana.com/tx/${entry.signature}?cluster=custom&customUrl=${encodeURIComponent(net.rpcUrl)}`;
  } catch (e) {
    const failure = findCustomError(e);
    entry.error = {
      code: failure?.code,
      name: failure ? describeError(failure.code) : 'transaction failed',
      message: e instanceof Error ? e.message : String(e),
    };
  }
  entry.after = await observe();
  return entry;
}

export { json };
