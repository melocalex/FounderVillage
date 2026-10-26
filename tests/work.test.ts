// Work bounties: claimed by a member, delivered, accepted or rejected by the council, and only
// then settled. No tokens exist without an accepted bounty.
import { beforeAll, describe, expect, it } from 'vitest';
import { fetchMint } from '@solana-program/token-2022';
import {
  BountyKind,
  BountyState,
  CACHAIN_ERROR__EMPTY_DELIVERY,
  CACHAIN_ERROR__INVALID_BOUNTY_STATE,
  CACHAIN_ERROR__INVALID_REWARD,
  CACHAIN_ERROR__INVALID_TITLE,
  CACHAIN_ERROR__NOT_CLAIMANT,
  CACHAIN_ERROR__NOT_COUNCIL,
  CACHAIN_ERROR__NOT_ELIGIBLE,
  CACHAIN_ERROR__WRONG_BOUNTY_KIND,
  claimBountyInstruction,
  fetchBounty,
  findBountyPda,
  getAcceptDeliveryInstructionAsync,
  getCurateBountyInstructionAsync,
  getRejectDeliveryInstructionAsync,
  getSubmitDeliveryInstructionAsync,
  proposeInstruction,
  settleWorkInstruction,
} from '../clients/ts/src';
import { config, councilSigner, hash, openBounty, TOKEN } from '../scripts/world';
import { contribute, holdings, join } from './flow';
import { expectCode, litesvmWorld } from './setup';

const work = config.workBounties[0]!;
const reward = BigInt(work.rewardTokens) * TOKEN;
const zeroTerms = { reward: 0n, priceNum: 0n, priceDen: 0n, target: 0n, deadline: 0n };

describe('work bounties', () => {
  let ctx: Awaited<ReturnType<typeof litesvmWorld>>;
  let bounty: Awaited<ReturnType<typeof openBounty>>;
  const supply = async () => {
    const { world } = ctx;
    const own = await fetchMint(world.client.rpc, world.asset.data.ownershipMint);
    const pro = await fetchMint(world.client.rpc, world.asset.data.profitMint);
    return [own.data.supply, pro.data.supply];
  };

  beforeAll(async () => {
    ctx = await litesvmWorld();
    await join(ctx.world, ctx.world.keys.ana);
    await join(ctx.world, ctx.world.keys.bruno);
    bounty = await openBounty(ctx.world, ctx.world.keys.ana, BountyKind.Work, work.title, { reward });
  });

  it('only lets an eligible member propose', async () => {
    const { world } = ctx;
    await world.refresh();
    await expectCode(
      world.send([await proposeInstruction(world.asset, world.keys.eve, BountyKind.Work, 'Gap from outside', await hash('x'))]),
      CACHAIN_ERROR__NOT_ELIGIBLE,
    );
    await expectCode(
      world.send([await proposeInstruction(world.asset, world.keys.ana, BountyKind.Work, '', await hash('x'))]),
      CACHAIN_ERROR__INVALID_TITLE,
    );
  });

  it('fixes the exchange at curation: curating again is refused', async () => {
    const { world } = ctx;
    const again = await getCurateBountyInstructionAsync({
      council: councilSigner(world),
      asset: world.asset.address,
      bounty,
      terms: { ...zeroTerms, reward: reward * 100n },
    });
    await expectCode(world.asCouncil([again]), CACHAIN_ERROR__INVALID_BOUNTY_STATE);
    expect((await fetchBounty(world.client.rpc, bounty)).data.terms.reward).toBe(reward);
  });

  it('refuses work terms without a reward, and financial actions on a work bounty', async () => {
    const { world } = ctx;
    await world.refresh();
    const next = await findBountyPda(world.asset.address, world.asset.data.nextBountyId);
    await world.send([await proposeInstruction(world.asset, world.keys.bruno, BountyKind.Work, 'No reward', await hash('n'))]);
    const curate = await getCurateBountyInstructionAsync({
      council: councilSigner(world),
      asset: world.asset.address,
      bounty: next,
      terms: zeroTerms,
    });
    await expectCode(world.asCouncil([curate]), CACHAIN_ERROR__INVALID_REWARD);
    await expectCode(contribute(world, bounty, world.keys.ana, 1n), CACHAIN_ERROR__WRONG_BOUNTY_KIND);
  });

  it('runs claimed → delivered → accepted → settled, minting exactly the reward', async () => {
    const { world } = ctx;
    const [ownBefore, proBefore] = await supply();
    await expectCode(
      world.send([await claimBountyInstruction(world.asset, bounty, world.keys.eve)]),
      CACHAIN_ERROR__NOT_ELIGIBLE,
    );
    await world.send([await claimBountyInstruction(world.asset, bounty, world.keys.bruno)]);

    const deliver = (claimant = world.keys.bruno, h?: Uint8Array) =>
      hash('rooftop-shade-drawings-v3').then((d) =>
        getSubmitDeliveryInstructionAsync({ claimant, bounty, deliveryHash: h ?? d }),
      );
    await expectCode(world.send([await deliver(world.keys.ana)]), CACHAIN_ERROR__NOT_CLAIMANT);
    await expectCode(world.send([await deliver(world.keys.bruno, new Uint8Array(32))]), CACHAIN_ERROR__EMPTY_DELIVERY);
    await world.send([await deliver()]);

    // No mint without an accepted bounty.
    await expectCode(world.send([await settleWorkInstruction(world.asset, bounty, world.keys.bruno.address)]), CACHAIN_ERROR__INVALID_BOUNTY_STATE);
    // One council member alone cannot accept.
    const accept = (council = councilSigner(world)) =>
      getAcceptDeliveryInstructionAsync({ council, asset: world.asset.address, bounty });
    await expectCode(world.send([await accept(world.keys.councilB)]), CACHAIN_ERROR__NOT_COUNCIL);
    await world.asCouncil([await accept()]);

    await world.send([await settleWorkInstruction(world.asset, bounty, world.keys.bruno.address)]);
    const bruno = await holdings(world, world.keys.bruno.address);
    expect(bruno.ownership).toBe(reward);
    expect(bruno.profit).toBe(reward);
    const [ownAfter, proAfter] = await supply();
    expect(ownAfter! - ownBefore!).toBe(reward + reward / 4n); // reward plus the holding's 20%
    expect(proAfter! - proBefore!).toBe(reward + reward / 4n);
    expect((await fetchBounty(world.client.rpc, bounty)).data.state).toBe(BountyState.Settled);

    // Settling twice is refused.
    await expectCode(world.send([await settleWorkInstruction(world.asset, bounty, world.keys.bruno.address)]), CACHAIN_ERROR__INVALID_BOUNTY_STATE);
  });

  it('mints nothing for a rejected delivery', async () => {
    const { world } = ctx;
    const second = config.workBounties[1]!;
    const b = await openBounty(world, world.keys.bruno, BountyKind.Work, second.title, {
      reward: BigInt(second.rewardTokens) * TOKEN,
    });
    await world.send([await claimBountyInstruction(world.asset, b, world.keys.ana)]);
    await world.send([
      await getSubmitDeliveryInstructionAsync({ claimant: world.keys.ana, bounty: b, deliveryHash: await hash('checklist-v1') }),
    ]);
    const before = await supply();
    await world.asCouncil([
      await getRejectDeliveryInstructionAsync({ council: councilSigner(world), asset: world.asset.address, bounty: b }),
    ]);
    await expectCode(world.send([await settleWorkInstruction(world.asset, b, world.keys.ana.address)]), CACHAIN_ERROR__INVALID_BOUNTY_STATE);
    expect(await supply()).toEqual(before);
    expect((await fetchBounty(world.client.rpc, b)).data.state).toBe(BountyState.Rejected);
  });
});
