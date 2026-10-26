// `npm run devnet:seed`: seeds the Founder Haus scenario on devnet, after `anchor deploy`.
//
// The client, the wallet that pays and the private role seed are in devnet-client.ts. Writes the
// addresses, with explorer links, to docs/devnet.md. Run it once per deployment.
import { writeFileSync } from 'node:fs';
import { lamports, type Address } from '@solana/kit';
import { getTransferSolInstruction } from '@solana-program/system';
import { FOUNDER_VILLAGE_PROGRAM_ADDRESS } from '../clients/ts/src';
import { client, devnetClient, devnetSeed } from './devnet-client';
import { seed } from './seed';
import { buildWorld } from './world';

const FUND = 50_000_000n; // 0.05 SOL per demo role: fees and the rent each role pays itself

const fund = async (to: Address, amount: bigint) => {
  const { value } = await client.rpc.getBalance(to).send();
  if (value >= amount) return;
  await devnetClient.sendTransaction([
    getTransferSolInstruction({ source: client.payer, destination: to, amount: lamports(amount - value) }),
  ]);
};

console.log(`▸ seeding Founder Haus on devnet, paid by ${client.payer.address}`);
const world = await buildWorld(devnetClient, fund, { seed: devnetSeed(true), fundLamports: FUND });
const { funding, work } = await seed(world);
const { keys, asset } = world;

const link = (a: string) => `[\`${a.slice(0, 4)}…${a.slice(-4)}\`](https://explorer.solana.com/address/${a}?cluster=devnet)`;
const rows: [string, string][] = [
  ['Founder Village program', FOUNDER_VILLAGE_PROGRAM_ADDRESS],
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
