// `npm run devnet:seed`: seeds the Founder Haus scenario on devnet, after `anchor deploy`.
//
// Pays with your wallet (~/.config/solana/id.json, or ANCHOR_WALLET), loaded as a signer and never
// printed. The demo roles (issuer, council, members) derive from a private seed kept in
// .devnet/seed (git-ignored), so nobody else can act as the devnet council or issuer. Writes the
// addresses, with explorer links, to docs/devnet.md. Run it once per deployment.
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { createClient, lamports, signature, type Address } from '@solana/kit';
import { solanaDevnetRpc } from '@solana/kit-plugin-rpc';
import { signerFromFile } from '@solana/kit-plugin-signer';
import { getTransferSolInstruction } from '@solana-program/system';
import { CACHAIN_PROGRAM_ADDRESS, SQUADS_PROGRAM_ADDRESS } from '../clients/ts/src';
import { SAS_PROGRAM_ADDRESS } from './localnet';
import { seed } from './seed';
import { buildWorld } from './world';

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
const FUND = 50_000_000n; // 0.05 SOL per demo role: fees and the rent each role pays itself

const client = await createClient()
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
const devnetClient = {
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
  ['Cachain', CACHAIN_PROGRAM_ADDRESS],
  ['Attestation Service', SAS_PROGRAM_ADDRESS],
  ['Squads', SQUADS_PROGRAM_ADDRESS],
] as const) {
  const { value } = await client.rpc.getAccountInfo(program as Address, { encoding: 'base64' }).send();
  if (!value?.executable) throw new Error(`${name} (${program}) is not deployed on devnet${name === 'Cachain' ? ': run anchor deploy first' : ''}`);
}

mkdirSync('.devnet', { recursive: true });
if (!existsSync('.devnet/seed')) writeFileSync('.devnet/seed', randomBytes(32).toString('hex'), { mode: 0o600 });
const secret = readFileSync('.devnet/seed', 'utf8').trim();

const fund = async (to: Address, amount: bigint) => {
  const { value } = await client.rpc.getBalance(to).send();
  if (value >= amount) return;
  await devnetClient.sendTransaction([
    getTransferSolInstruction({ source: client.payer, destination: to, amount: lamports(amount - value) }),
  ]);
};

console.log(`▸ seeding Founder Haus on devnet, paid by ${client.payer.address}`);
const world = await buildWorld(devnetClient, fund, { seed: `cachain-devnet:${secret}`, fundLamports: FUND });
const { funding, work } = await seed(world);
const { keys, asset } = world;

const link = (a: string) => `[\`${a.slice(0, 4)}…${a.slice(-4)}\`](https://explorer.solana.com/address/${a}?cluster=devnet)`;
const rows: [string, string][] = [
  ['Cachain program', CACHAIN_PROGRAM_ADDRESS],
  ['Asset (Founder Haus)', asset.address],
  ['Ownership mint (FHO)', asset.data.ownershipMint],
  ['Profit mint (FHP)', asset.data.profitMint],
  ['Capital vault', asset.data.capitalVault],
  ['Income vault', asset.data.incomeVault],
  ['USDC stand-in mint', world.usdc],
  ['Council (Squads vault)', world.council],
  ['Squads multisig', world.multisig],
  ['Whitelist credential (SAS)', world.issuer.credential],
  ['Member schema (SAS)', world.issuer.schema],
  ['Tranche 2 bounty', funding],
  ['Rooftop work bounty', work],
  ['Ana (whitelisted, funded the tranche)', keys.ana.address],
  ['Bruno (whitelisted)', keys.bruno.address],
  ['Holding', keys.holding.address],
];
writeFileSync(
  'docs/devnet.md',
  `# Founder Haus on devnet

Seeded on ${new Date().toISOString().slice(0, 10)} by \`npm run devnet:seed\`: the whitelist credential, a 2-of-3
council, the asset with both tokens, an open tranche with one contribution, an open work bounty, and
one rent payment. Devnet is a public test network: these tokens have no value.

| What | Address |
|---|---|
${rows.map(([k, v]) => `| ${k} | ${link(v)} |`).join('\n')}
`,
);
for (const [k, v] of rows) console.log(`  ${k.padEnd(40)} https://explorer.solana.com/address/${v}?cluster=devnet`);
console.log('\nWrote docs/devnet.md');
