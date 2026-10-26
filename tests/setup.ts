// LiteSVM world: the Cachain program from target/deploy plus the mainnet SAS and Squads
// binaries fetched by `npm run fixtures:programs`. Everything runs in process.
import { readFileSync } from 'node:fs';
import { expect } from 'vitest';
import { address, createClient, lamports, type Address } from '@solana/kit';
import { litesvm } from '@solana/kit-plugin-litesvm';
import { signer } from '@solana/kit-plugin-signer';
import { Clock } from 'litesvm';
import { CACHAIN_PROGRAM_ADDRESS, findCustomError, SQUADS_PROGRAM_ADDRESS } from '../clients/ts/src';
import { demoSigner, type DemoRole } from '../clients/ts/src/demo';
import { buildWorld } from '../scripts/world';

const SAS = address('22zoJMtdu4tQc2PzL74ZUT7FrwgB1Udec8DdW4yw4BdG');

export async function litesvmWorld(options?: { attest?: DemoRole[] }) {
  const payer = await demoSigner('creator');
  const client = await createClient()
    .use(signer(payer))
    .use(litesvm({ transactionConfig: { version: 1 } }));
  client.svm.addProgramFromFile(CACHAIN_PROGRAM_ADDRESS, 'target/deploy/cachain.so');
  client.svm.addProgramFromFile(SAS, 'tests/fixtures/sas.so');
  client.svm.addProgramFromFile(SQUADS_PROGRAM_ADDRESS, 'tests/fixtures/squads.so');
  const programConfig = JSON.parse(readFileSync('tests/fixtures/squads-program-config.json', 'utf8'));
  client.svm.setAccount({
    address: address(programConfig.address),
    programAddress: address(programConfig.owner),
    lamports: lamports(BigInt(programConfig.lamports)),
    data: Uint8Array.from(Buffer.from(programConfig.data, 'base64')),
    executable: false,
    space: 144n,
  });
  const fund = (who: Address, amount: bigint) => {
    client.svm.airdrop(who, lamports(amount));
  };
  // LiteSVM keeps one blockhash until told otherwise, so a repeated transaction (re-attesting
  // a wallet, say) would be dropped as already processed. Move it after every send.
  const fresh: typeof client = {
    ...client,
    sendTransaction: (async (input: Parameters<typeof client.sendTransaction>[0]) => {
      try {
        return await client.sendTransaction(input);
      } finally {
        client.svm.expireBlockhash();
      }
    }) as typeof client.sendTransaction,
  };
  const world = await buildWorld(fresh, fund, options);

  /** Moves the cluster clock to `unix` seconds. */
  const setTime = (unix: bigint) => {
    const c = client.svm.getClock();
    client.svm.setClock(new Clock(c.slot + 1n, c.epochStartTimestamp, c.epoch, c.leaderScheduleEpoch, unix));
  };
  const now = () => client.svm.getClock().unixTimestamp;
  return { client: fresh, world, setTime, now };
}

/** Asserts the promise rejects with exactly `code` from a program. */
export async function expectCode(promise: Promise<unknown>, code: number) {
  let error: unknown;
  try {
    await promise;
  } catch (e) {
    error = e;
  }
  expect(error, 'expected the transaction to fail').toBeDefined();
  const failure = findCustomError(error);
  expect(failure?.code, `wrong error: ${String((error as Error)?.message ?? error)}`).toBe(code);
}

/** Asserts the promise rejects, for failures raised by the runtime rather than a custom code. */
export async function expectFailure(promise: Promise<unknown>, contains: string) {
  await expect(promise).rejects.toThrow(new RegExp(contains, 'i'));
}
