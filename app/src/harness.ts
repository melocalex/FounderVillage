// Everything the harness page does to the chain, kept apart from the markup. The production
// frontend should read this file for the sequence of calls, not for its UI.
import { AccountRole, createClient, type Address, type Instruction, type TransactionSigner } from '@solana/kit';
import { solanaRpc } from '@solana/kit-plugin-rpc';
import { signer } from '@solana/kit-plugin-signer';
import { fetchMaybeToken, AccountState } from '@solana-program/token-2022';
import { fetchMaybeToken as fetchMaybeClassicToken } from '@solana-program/token';
import { fetchMaybeAttestation } from '@solana/attestation';
import {
  CACHAIN_PROGRAM_ADDRESS,
  CachainInstruction,
  describeError,
  fetchAsset,
  fetchBounty,
  fetchMaybePosition,
  findBountyPda,
  findCustomError,
  holderAccounts,
  identifyCachainInstruction,
  squadsClient,
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
  const net: Localnet = await res.json();
  // `npm run dev` proxies Surfpool at /rpc and /ws on the harness's own origin.
  const origin = (path: string, ws: boolean) =>
    path.startsWith('/')
      ? `${ws ? (location.protocol === 'https:' ? 'wss' : 'ws') : location.protocol.replace(':', '')}://${location.host}${path}`
      : path;
  return { ...net, rpcUrl: origin(net.rpcUrl, false), wsUrl: origin(net.wsUrl, true) };
}

export type Client = ReturnType<typeof clientFor>;

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

export const json = (value: unknown) =>
  JSON.parse(JSON.stringify(value, (_k, v) => (typeof v === 'bigint' ? v.toString() : v)));

/** Account data without the 8-byte discriminator, for display. */
export const plain = <T extends { discriminator?: unknown }>({ discriminator: _d, ...rest }: T) => rest;

/** Base units to a decimal string: 1500000 → "1.5". */
export function fmt(units: bigint | string | number, decimals = 6): string {
  const v = BigInt(units);
  const scale = 10n ** BigInt(decimals);
  const a = v < 0n ? -v : v;
  const frac = (a % scale).toString().padStart(decimals, '0').replace(/0+$/, '');
  return `${v < 0n ? '-' : ''}${(a / scale).toLocaleString('en-US')}${frac ? `.${frac}` : ''}`;
}

/** A decimal string to base units: "1.5" → 1500000. */
export function units(text: string, decimals = 6): bigint {
  const [whole = '0', frac = ''] = text.trim().split('.');
  return BigInt(whole || '0') * 10n ** BigInt(decimals) + BigInt((frac + '0'.repeat(decimals)).slice(0, decimals) || '0');
}

export const short = (a: string) => `${a.slice(0, 4)}…${a.slice(-4)}`;

export async function loadAssetState(client: Client, net: Localnet): Promise<LoadedAsset> {
  return { address: net.asset, data: (await fetchAsset(client.rpc, net.asset)).data };
}

export async function listBounties(client: Client, asset: LoadedAsset) {
  const out = [];
  for (let id = 0n; id < asset.data.nextBountyId; id++) {
    const address = await findBountyPda(asset.address, id);
    out.push({ address, ...plain((await fetchBounty(client.rpc, address)).data) });
  }
  return out;
}

export type Bounty = Awaited<ReturnType<typeof listBounties>>[number];

export async function vaultBalances(client: Client, asset: LoadedAsset) {
  const amount = async (a: Address) => {
    const t = await fetchMaybeClassicToken(client.rpc, a);
    return t.exists ? t.data.amount : 0n;
  };
  return { capital: await amount(asset.data.capitalVault), income: await amount(asset.data.incomeVault) };
}

type TokenState = { address: Address; state: 'none' | 'frozen' | 'thawed'; amount: bigint };

/** What the chain says about one holder: attestation, token accounts, position, funds. */
export async function holderState(client: Client, asset: LoadedAsset, owner: Address) {
  const h = await holderAccounts(asset, owner);
  const attestation = await fetchMaybeAttestation(client.rpc, h.attestation);
  const token = async (a: Address): Promise<TokenState> => {
    const t = await fetchMaybeToken(client.rpc, a);
    if (!t.exists) return { address: a, state: 'none', amount: 0n };
    return { address: a, state: t.data.state === AccountState.Frozen ? 'frozen' : 'thawed', amount: t.data.amount };
  };
  const funds = await fetchMaybeClassicToken(client.rpc, h.funds);
  const position = await fetchMaybePosition(client.rpc, h.position);
  const now = BigInt(Math.floor(Date.now() / 1000));
  // Accrual is settled lazily on-chain; this is what claim_distribution would pay now.
  const claimable = position.exists
    ? position.data.accrued +
      (position.data.balance * (asset.data.distribution.rewardIndex - position.data.index)) / 1_000_000_000_000n
    : 0n;
  return {
    owner,
    attestation: attestation.exists
      ? {
          address: h.attestation,
          status: attestation.data.expiry !== 0n && attestation.data.expiry <= now ? ('expired' as const) : ('verified' as const),
          expiry: attestation.data.expiry,
        }
      : { address: h.attestation, status: 'none' as const, expiry: 0n },
    ownership: await token(h.ownership),
    profit: await token(h.profit),
    usdc: funds.exists ? funds.data.amount : 0n,
    position: position.exists ? { address: h.position, ...plain(position.data) } : undefined,
    claimable,
  };
}

export type HolderState = Awaited<ReturnType<typeof holderState>>;

export async function proposalState(client: Client, proposal: Address) {
  const p = await squadsClient.fetchMaybeProposal(client.rpc, proposal);
  return p.exists ? { status: p.data.status.__kind, approved: p.data.approved } : undefined;
}

export type LogEntry = {
  id: number;
  at: Date;
  label: string;
  signer: Address;
  instructions: { program: string; name: string; accounts: { address: Address; role: string }[] }[];
  signature?: string;
  explorer?: string;
  error?: { code?: number; name: string; message: string };
  changes: Change[];
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
  } else if (ix.programAddress === SQUADS_PROGRAM_ADDRESS) {
    name = 'multisig';
  }
  const program =
    ix.programAddress === CACHAIN_PROGRAM_ADDRESS
      ? 'cachain'
      : ix.programAddress === SQUADS_PROGRAM_ADDRESS
        ? 'squads'
        : short(ix.programAddress);
  return {
    program,
    name,
    accounts: (ix.accounts ?? []).map((a) => ({ address: a.address, role: ROLE[a.role as AccountRole] ?? String(a.role) })),
  };
}

export type Change = { path: string; from: unknown; to: unknown };

/** Leaf-level differences between two JSON-safe values. */
export function diff(before: unknown, after: unknown, path = ''): Change[] {
  if (typeof before !== 'object' || typeof after !== 'object' || before === null || after === null) {
    return JSON.stringify(before) === JSON.stringify(after) ? [] : [{ path, from: before, to: after }];
  }
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  return [...keys].flatMap((k) =>
    diff((before as Record<string, unknown>)[k], (after as Record<string, unknown>)[k], path ? `${path}.${k}` : k),
  );
}

let nextId = 1;

/** Sends `instructions` as `as`, recording what changed on-chain and any program error. */
export async function run(
  net: Localnet,
  as: TransactionSigner,
  label: string,
  instructions: Instruction[],
  observe: () => Promise<unknown>,
): Promise<LogEntry> {
  const before = json(await observe());
  const entry: LogEntry = { id: nextId++, at: new Date(), label, signer: as.address, instructions: instructions.map(describe), changes: [] };
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
  entry.changes = diff(before, json(await observe()));
  return entry;
}
