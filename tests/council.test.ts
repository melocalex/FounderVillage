// The council is a 2-of-3 Squads vault: no single key can curate, accept, pause or move capital.
import { beforeAll, describe, expect, it } from 'vitest';
import {
  BountyKind,
  BountyState,
  CACHAIN_ERROR__NOT_COUNCIL,
  councilAction,
  fetchBounty,
  findBountyPda,
  getCurateBountyInstructionAsync,
  proposeInstruction,
  squadsClient,
} from '../clients/ts/src';
import { councilSigner, hash, TOKEN } from '../scripts/world';
import { expectCode, litesvmWorld } from './setup';

const { SQUADS_MULTISIG_PROGRAM_ERROR__INVALID_PROPOSAL_STATUS, SQUADS_MULTISIG_PROGRAM_ERROR__NOT_A_MEMBER } = squadsClient;
const terms = { reward: 1_000n * TOKEN, priceNum: 0n, priceDen: 0n, target: 0n, deadline: 0n };

describe('council', () => {
  let ctx: Awaited<ReturnType<typeof litesvmWorld>>;
  let bounty: Awaited<ReturnType<typeof findBountyPda>>;

  beforeAll(async () => {
    ctx = await litesvmWorld();
    const { world } = ctx;
    bounty = await findBountyPda(world.asset.address, world.asset.data.nextBountyId);
    await world.send([await proposeInstruction(world.asset, world.keys.ana, BountyKind.Work, 'Solar canopy', await hash('solar'))]);
  });

  const curate = (council = councilSigner(ctx.world)) =>
    getCurateBountyInstructionAsync({ council, asset: ctx.world.asset.address, bounty, terms });

  it('refuses curation signed by one member key', async () => {
    await expectCode(ctx.world.send([await curate(ctx.world.keys.councilA)]), CACHAIN_ERROR__NOT_COUNCIL);
  });

  it('refuses to execute a council action with one approval of two', async () => {
    const { world } = ctx;
    const action = await councilAction(world.client.rpc, world.multisig, [await curate()], world.keys.councilA);
    await world.send(action.propose);
    await expectCode(world.send([action.execute(world.keys.councilA)]), SQUADS_MULTISIG_PROGRAM_ERROR__INVALID_PROPOSAL_STATUS);
    // An outsider cannot supply the missing approval.
    await expectCode(world.send([action.approve(world.keys.eve)]), SQUADS_MULTISIG_PROGRAM_ERROR__NOT_A_MEMBER);
    expect((await fetchBounty(world.client.rpc, bounty)).data.state).toBe(BountyState.Proposed);

    // The second member's approval is what makes it executable.
    await world.send([action.approve(world.keys.councilC)]);
    await world.send([action.execute(world.keys.councilB)]);
    expect((await fetchBounty(world.client.rpc, bounty)).data.state).toBe(BountyState.Curated);
  });
});
