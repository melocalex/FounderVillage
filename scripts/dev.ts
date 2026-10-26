// `npm run dev`: builds what is missing, boots an offline Surfpool, deploys the programs, seeds
// the Founder Haus fixtures, prints every address, and serves the test harness.
//   --seed-only  stop after seeding (used by CI as a smoke test)
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { DEMO_SEED } from '../clients/ts/src/demo';
import { CACHAIN_PROGRAM_ADDRESS, holderAccounts, SQUADS_PROGRAM_ADDRESS } from '../clients/ts/src';
import { missingArtifacts, SAS_PROGRAM_ADDRESS, startLocalnet } from './localnet';
import { seed } from './seed';

const step = (text: string) => console.log(`\n▸ ${text}`);

const missing = missingArtifacts();
if (missing.some((f) => f.endsWith('cachain.so'))) {
  step('building the program (anchor build)');
  execFileSync('anchor', ['build'], { stdio: 'inherit', env: { ...process.env, NO_DNA: '1' } });
}
if (missing.some((f) => f.startsWith('tests/fixtures'))) {
  step('fetching SAS and Squads binaries from mainnet (read-only)');
  execFileSync('npx', ['tsx', 'scripts/dump-programs.ts'], { stdio: 'inherit' });
}

step('starting Surfpool (offline) and seeding Founder Haus');
const { surfnet, world } = await startLocalnet();
const { funding, work } = await seed(world);

const { keys, asset } = world;
const rows: [string, string][] = [
  ['RPC', surfnet.rpcUrl],
  ['WebSocket', surfnet.wsUrl],
  ['Cachain program', CACHAIN_PROGRAM_ADDRESS],
  ['SAS program', SAS_PROGRAM_ADDRESS],
  ['Squads program', SQUADS_PROGRAM_ADDRESS],
  ['Asset (Founder Haus)', asset.address],
  ['Ownership mint (FHO)', asset.data.ownershipMint],
  ['Profit mint (FHP)', asset.data.profitMint],
  ['USDC (local stand-in)', world.usdc],
  ['Council (Squads vault)', world.council],
  ['Squads multisig', world.multisig],
  ['SAS credential', world.issuer.credential],
  ['SAS schema', world.issuer.schema],
  ['Holding', keys.holding.address],
  ['Ana (eligible, funded)', keys.ana.address],
  ['Bruno (eligible)', keys.bruno.address],
  ['Eve (not whitelisted)', keys.eve.address],
  ['Operator (pays rent)', keys.operator.address],
  ['Tranche 2 bounty', funding],
  ['Work bounty', work],
];
console.log('\nLocal Founder Haus is up. Demo keys derive from the public seed', JSON.stringify(DEMO_SEED), '(localnet only).\n');
for (const [k, v] of rows) console.log(`  ${k.padEnd(26)} ${v}`);

mkdirSync('app/public', { recursive: true });
writeFileSync(
  'app/public/localnet.json',
  JSON.stringify(
    {
      rpcUrl: surfnet.rpcUrl,
      wsUrl: surfnet.wsUrl,
      asset: asset.address,
      multisig: world.multisig,
      council: world.council,
      bounties: { funding, work },
      ana: await holderAccounts(asset, keys.ana.address),
    },
    null,
    2,
  ),
);

if (process.argv.includes('--seed-only')) {
  surfnet.stop();
  process.exit(0);
}

step('serving the harness');
const { createServer } = await import('vite');
const server = await createServer({ configFile: 'app/vite.config.ts' });
await server.listen();
server.printUrls();
console.log('\nCtrl-C stops everything.');
const shutdown = async () => {
  await server.close();
  surfnet.stop();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
