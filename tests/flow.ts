// Steps of the demo path, shared by the test files.
import type { Address, KeyPairSigner } from '@solana/kit';
import { fetchToken as fetchToken2022 } from '@solana-program/token-2022';
import { fetchToken } from '@solana-program/token';
import {
  BountyKind,
  contributeInstruction,
  fetchAsset,
  fetchPosition,
  holderAccounts,
  joinInstructions,
  recordInflowInstruction,
} from '../clients/ts/src';
import { config, openBounty, USDC, type World } from '../scripts/world';

let receipts = 0n;

export const stage2 = (world: World) =>
  openBounty(world, world.keys.ana, BountyKind.Financial, config.tranches[0]!.title, {
    priceNum: BigInt(config.price.tokensPerUsdcNum),
    priceDen: BigInt(config.price.tokensPerUsdcDen),
    target: BigInt(config.tranches[0]!.targetUsdc) * USDC,
  });

export async function join(world: World, who: KeyPairSigner) {
  await world.refresh();
  await world.send(await joinInstructions(world.client.rpc, world.asset, who.address, world.client.payer));
}

export async function contribute(world: World, bounty: Address, who: KeyPairSigner, usdc: bigint) {
  await world.refresh();
  receipts += 1n;
  return world.send([await contributeInstruction(world.asset, bounty, who, usdc, receipts)]);
}

export async function recordInflow(world: World, usdc: bigint) {
  await world.refresh();
  return world.send([await recordInflowInstruction(world.asset, world.keys.operator, usdc)]);
}

/** Asset-token balances (ownership, profit) and position of `owner`. */
export async function holdings(world: World, owner: Address) {
  const h = await holderAccounts(world.asset, owner);
  const rpc = world.client.rpc;
  const amount = async (a: Address) => {
    try {
      return (await fetchToken2022(rpc, a)).data.amount;
    } catch {
      return 0n;
    }
  };
  let position = { balance: 0n, accrued: 0n, claimed: 0n };
  try {
    position = (await fetchPosition(rpc, h.position)).data;
  } catch {
    // no position yet
  }
  return { ownership: await amount(h.ownership), profit: await amount(h.profit), position };
}

export async function usdcBalance(world: World, account: Address) {
  return (await fetchToken(world.client.rpc, account)).data.amount;
}

export async function ledger(world: World) {
  return (await fetchAsset(world.client.rpc, world.asset.address)).data;
}
