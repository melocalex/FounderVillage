// An offline Surfpool with everything the demo needs: Cachain from target/deploy, and the
// mainnet SAS and Squads binaries plus Squads' ProgramConfig from tests/fixtures. Offline means
// no mainnet reads at run time and the same state on every boot.
import { existsSync, readFileSync } from 'node:fs';
import { createClient } from '@solana/kit';
import { signer } from '@solana/kit-plugin-signer';
import { Surfnet } from '@solana/surfpool';
import { surfpool } from '@solana/surfpool/kit';
import { CACHAIN_PROGRAM_ADDRESS, SQUADS_PROGRAM_ADDRESS } from '../clients/ts/src';
import { demoSigner } from '../clients/ts/src/demo';
import { buildWorld } from './world';

export const SAS_PROGRAM_ADDRESS = '22zoJMtdu4tQc2PzL74ZUT7FrwgB1Udec8DdW4yw4BdG';
const PROGRAM = 'target/deploy/cachain.so';
const FIXTURES = ['tests/fixtures/sas.so', 'tests/fixtures/squads.so', 'tests/fixtures/squads-program-config.json'];

export function missingArtifacts(): string[] {
  return [PROGRAM, ...FIXTURES].filter((f) => !existsSync(f));
}

export async function startLocalnet() {
  const missing = missingArtifacts();
  if (missing.length) throw new Error(`missing ${missing.join(', ')}: run \`npm run build:program\` and \`npm run fixtures:programs\``);

  const surfnet = Surfnet.startWithConfig({ offline: true });
  surfnet.deploy({ programId: CACHAIN_PROGRAM_ADDRESS, soPath: PROGRAM });
  surfnet.deploy({ programId: SAS_PROGRAM_ADDRESS, soPath: 'tests/fixtures/sas.so' });
  surfnet.deploy({ programId: SQUADS_PROGRAM_ADDRESS, soPath: 'tests/fixtures/squads.so' });
  const config = JSON.parse(readFileSync('tests/fixtures/squads-program-config.json', 'utf8'));
  surfnet.setAccount(config.address, Number(config.lamports), Buffer.from(config.data, 'base64'), config.owner);

  const client = createClient()
    .use(signer(await demoSigner('creator')))
    .use(surfpool({ rpcUrl: surfnet.rpcUrl, rpcSubscriptionsUrl: surfnet.wsUrl, transactionConfig: { version: 1 } }));
  const world = await buildWorld(client, (address, lamports) => surfnet.fundSol(address, Number(lamports)));
  return { surfnet, client, world };
}
