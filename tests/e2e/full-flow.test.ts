// The whole demo path (PROMPT §11.7) on a real RPC: an offline Surfpool running the mainnet SAS
// and Squads binaries. Curate a gap into a bounty, fund it, thaw the claim through the gate,
// deliver and accept work through the multisig, record rent, claim it.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  BountyKind,
  BountyState,
  CACHAIN_ERROR__NOT_ELIGIBLE,
  claimBountyInstruction,
  claimDistributionInstruction,
  contributeInstruction,
  fetchBounty,
  getAcceptDeliveryInstructionAsync,
  getSubmitDeliveryInstructionAsync,
  joinInstructions,
  recordInflowInstruction,
  settleWorkInstruction,
} from '../../clients/ts/src';
import { startLocalnet } from '../../scripts/localnet';
import { councilSigner, hash, openBounty, TOKEN, USDC } from '../../scripts/world';
import { expectCode } from '../setup';

describe('Founder Haus end to end on Surfpool', () => {
  let net: Awaited<ReturnType<typeof startLocalnet>>;
  beforeAll(async () => {
    net = await startLocalnet();
  });
  afterAll(() => net?.surfnet.stop());

  it('runs gap → bounty → funding → gate → work → rent → claim', async () => {
    const { world } = net;
    const { keys } = world;
    const rpc = world.client.rpc;

    // A non-whitelisted wallet is turned away at the gate.
    await expectCode(
      world.send(await joinInstructions(rpc, world.asset, keys.eve.address, world.client.payer)),
      CACHAIN_ERROR__NOT_ELIGIBLE,
    );
    for (const m of [keys.ana, keys.bruno]) {
      await world.send(await joinInstructions(rpc, world.asset, m.address, world.client.payer));
    }

    // Financial bounty: curated and opened by the 2-of-3 council, funded in USDC.
    const tranche = await openBounty(world, keys.ana, BountyKind.Financial, 'Tranche 2: founding members', {
      priceNum: 1n,
      priceDen: 1n,
      target: 300_000n * USDC,
    });
    await world.send([await contributeInstruction(world.asset, tranche, keys.ana, 10_000n * USDC, 1n)]);

    // Work bounty: claimed, delivered, accepted through Squads, settled.
    const work = await openBounty(world, keys.bruno, BountyKind.Work, 'Rooftop shade structure', { reward: 2_500n * TOKEN });
    await world.send([await claimBountyInstruction(world.asset, work, keys.bruno)]);
    await world.send([
      await getSubmitDeliveryInstructionAsync({ claimant: keys.bruno, bounty: work, deliveryHash: await hash('drawings') }),
    ]);
    await world.asCouncil([
      await getAcceptDeliveryInstructionAsync({ council: councilSigner(world), asset: world.asset.address, bounty: work }),
    ]);
    await world.send([await settleWorkInstruction(world.asset, work, keys.bruno.address)]);
    expect((await fetchBounty(rpc, work)).data.state).toBe(BountyState.Settled);

    // Rent comes in and reaches holders pro rata: profit supply is 12,500 + 3,125 = 15,625.
    await world.send([await recordInflowInstruction(world.asset, keys.operator, 1_562_500_000n)]);
    const before = await world.client.rpc.getTokenAccountBalance(await world.usdcAta(keys.ana.address)).send();
    await world.send([await claimDistributionInstruction(world.asset, keys.ana)]);
    const after = await world.client.rpc.getTokenAccountBalance(await world.usdcAta(keys.ana.address)).send();
    expect(BigInt(after.value.amount) - BigInt(before.value.amount)).toBe(1_000n * USDC);
  });
});
