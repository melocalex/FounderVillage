// The devnet client shared by `devnet:seed` and `devnet:onboard`.
//
// Pays with your wallet (~/.config/solana/id.json, or ANCHOR_WALLET), loaded as a signer and never
// printed. The demo roles (issuer, council, members) derive from a private seed kept in
// .devnet/seed (git-ignored), so nobody else can act as the devnet council or issuer.
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { createClient, signature, type Address } from '@solana/kit';
import { solanaDevnetRpc } from '@solana/kit-plugin-rpc';
import { signerFromFile } from '@solana/kit-plugin-signer';
import { FOUNDER_VILLAGE_PROGRAM_ADDRESS, SQUADS_PROGRAM_ADDRESS } from '../clients/ts/src';
import { SAS_PROGRAM_ADDRESS } from './localnet';

// The public devnet RPC rate-limits by IP. A 429 is the limiter refusing the request before the
// node sees it, so retrying the same request (sendTransaction included) cannot apply anything twice.
const realFetch = globalThis.fetch;
globalThis.fetch = async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
  for (let attempt = 0; ; attempt++) {
    const res = await realFetch(input, init);
    if (res.status !== 429 || attempt >= 8) return res;
    await new Promise((r) => setTimeout(r, 1000 * 2 ** Math.min(attempt, 4)));
  }
};

const DEVNET_GENESIS = 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG';
const wallet = process.env.ANCHOR_WALLET || `${homedir()}/.config/solana/id.json`;

export const client = await createClient()
  .use(signerFromFile(wallet))
  .use(solanaDevnetRpc({ transactionConfig: { version: 1 } }));

if ((await client.rpc.getGenesisHash().send()) !== DEVNET_GENESIS) throw new Error('RPC is not devnet');

// Devnet's public WebSocket sometimes refuses the confirmation subscription after a transaction
// was already sent. Then the outcome is unknown, so ask for the signature's status over HTTP:
// landed means done (never resend), failed means fail, and absent after its blockhash expired
// (~2 min) is the only case where sending again is safe.
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const sentSignature = (e: unknown) => {
  const ctx = (e as { context?: { causeMessage?: string } }).context;
  if (!/WebSocket|block height exceeded|timed out/i.test(ctx?.causeMessage ?? '')) return undefined;
  return (e as Error).message.match(/\(([1-9A-HJ-NP-Za-km-z]{80,90})\)/)?.[1];
};
const outcome = async (sig: string) => {
  for (let i = 0; i < 60; i++) {
    const { value } = await client.rpc.getSignatureStatuses([signature(sig)], { searchTransactionHistory: true }).send();
    const s = value[0];
    if (s && (s.confirmationStatus === 'confirmed' || s.confirmationStatus === 'finalized')) return s.err ? 'failed' : 'landed';
    await sleep(2000);
  }
  return 'absent';
};
export const devnetClient = {
  ...client,
  sendTransaction: async (input: Parameters<typeof client.sendTransaction>[0]) => {
    for (let attempt = 0; ; attempt++) {
      try {
        return await client.sendTransaction(input);
      } catch (e) {
        const sig = sentSignature(e);
        if (!sig) throw e;
        const result = await outcome(sig);
        console.log(`  confirmation lost for ${sig.slice(0, 8)}…; status over HTTP: ${result}`);
        if (result === 'landed') return undefined;
        if (result === 'failed' || attempt >= 3) throw e;
      }
    }
  },
};
for (const [name, program] of [
  ['Founder Village', FOUNDER_VILLAGE_PROGRAM_ADDRESS],
  ['Attestation Service', SAS_PROGRAM_ADDRESS],
  ['Squads', SQUADS_PROGRAM_ADDRESS],
] as const) {
  const { value } = await client.rpc.getAccountInfo(program as Address, { encoding: 'base64' }).send();
  if (!value?.executable) throw new Error(`${name} (${program}) is not deployed on devnet${name === 'Founder Village' ? ': run anchor deploy first' : ''}`);
}

/** The seed the devnet demo roles derive from. `create` makes it on the first `devnet:seed`. */
export function devnetSeed(create: boolean): string {
  if (!existsSync('.devnet/seed')) {
    if (!create) throw new Error('.devnet/seed is missing: run npm run devnet:seed first, on the machine that seeded devnet');
    mkdirSync('.devnet', { recursive: true });
    writeFileSync('.devnet/seed', randomBytes(32).toString('hex'), { mode: 0o600 });
  }
  // Frozen salt (the protocol's working name): changing it changes every devnet role key.
  return `cachain-devnet:${readFileSync('.devnet/seed', 'utf8').trim()}`;
}
