// The demo fixtures every frontend can render immediately (PROMPT §12.2): an eligible member
// and an ineligible wallet, the asset with its mints, two open bounties (a tranche and a work
// bounty), one funded position, and one claimable distribution.
import { BountyKind, contributeInstruction, joinInstructions, recordInflowInstruction } from '../clients/ts/src';
import { config, openBounty, TOKEN, USDC, type World } from './world';

export async function seed(world: World) {
  const { keys } = world;
  for (const member of [keys.ana, keys.bruno]) {
    await world.refresh();
    await world.send(await joinInstructions(world.client.rpc, world.asset, member.address, world.client.payer));
  }
  const tranche = config.tranches[0]!;
  const funding = await openBounty(world, keys.ana, BountyKind.Financial, tranche.title, {
    priceNum: BigInt(config.price.tokensPerUsdcNum),
    priceDen: BigInt(config.price.tokensPerUsdcDen),
    target: BigInt(tranche.targetUsdc) * USDC,
  });
  const job = config.workBounties[0]!;
  const work = await openBounty(world, keys.bruno, BountyKind.Work, job.title, {
    reward: BigInt(job.rewardTokens) * TOKEN,
  });
  await world.send([await contributeInstruction(world.asset, funding, keys.ana, 10_000n * USDC, 1n)]);
  await world.send([await recordInflowInstruction(world.asset, keys.operator, 1_000n * USDC)]);
  await world.refresh();
  return { funding, work };
}
