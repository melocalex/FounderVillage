// Rent reaches profit holders pro rata, the ledger follows tokens through the transfer hook, a
// holder cannot claim twice, and the program never pays out more than it recorded.
import { beforeAll, describe, expect, it } from 'vitest';
import { getTransferCheckedWithTransferHookInstructionAsync } from '@solana-program/token-2022';
import {
  CACHAIN_ERROR__NOT_ELIGIBLE,
  CACHAIN_ERROR__NOTHING_TO_CLAIM,
  claimDistributionInstruction,
  freezeInstructions,
  holderAccounts,
  revokeInstruction,
} from '../clients/ts/src';
import { TOKEN, USDC } from '../scripts/world';
import { contribute, holdings, join, ledger, recordInflow, stage2, usdcBalance } from './flow';
import { expectCode, litesvmWorld } from './setup';

describe('distributions', () => {
  let ctx: Awaited<ReturnType<typeof litesvmWorld>>;
  const accrued = async (who: 'ana' | 'bruno' | 'holding') => {
    const { world } = ctx;
    // Accrued so far = stored accrual + what the current index owes the balance.
    const h = await holdings(world, world.keys[who].address);
    const asset = await ledger(world);
    const pending = (h.position.balance * (asset.distribution.rewardIndex - (await position(who)).index)) / 1_000_000_000_000n;
    return h.position.accrued + pending;
  };
  const position = async (who: 'ana' | 'bruno' | 'holding') => {
    const { fetchPosition } = await import('../clients/ts/src');
    const h = await holderAccounts(ctx.world.asset, ctx.world.keys[who].address);
    return (await fetchPosition(ctx.world.client.rpc, h.position)).data;
  };
  const transferProfit = async (from: 'ana' | 'bruno', to: 'ana' | 'bruno', amount: bigint) => {
    const { world } = ctx;
    const a = await holderAccounts(world.asset, world.keys[from].address);
    const b = await holderAccounts(world.asset, world.keys[to].address);
    return world.send([
      await getTransferCheckedWithTransferHookInstructionAsync(world.client, {
        source: a.profit,
        mint: world.asset.data.profitMint,
        destination: b.profit,
        authority: world.keys[from],
        amount,
        decimals: 6,
      }),
    ]);
  };

  beforeAll(async () => {
    ctx = await litesvmWorld();
    const { world } = ctx;
    await join(world, world.keys.ana);
    await join(world, world.keys.bruno);
    const bounty = await stage2(world);
    await contribute(world, bounty, world.keys.ana, 10_000n * USDC);
    await contribute(world, bounty, world.keys.bruno, 5_000n * USDC);
    // Profit supply: ana 10,000, bruno 5,000, holding 3,750 = 18,750.
  });

  it('splits an inflow pro rata over profit holders and mints nothing', async () => {
    const { world } = ctx;
    const before = await ledger(world);
    await recordInflow(world, 1_875n * USDC);
    expect(await accrued('ana')).toBe(1_000n * USDC);
    expect(await accrued('bruno')).toBe(500n * USDC);
    expect(await accrued('holding')).toBe(375n * USDC);
    const after = await ledger(world);
    expect(after.distribution.trackedSupply).toBe(before.distribution.trackedSupply);
    expect(after.ledger.income).toBe(1_875n * USDC);
  });

  it('moves future income with transferred profit tokens; past income stays with the sender', async () => {
    const { world } = ctx;
    await transferProfit('ana', 'bruno', 2_000n * TOKEN);
    expect((await position('ana')).balance).toBe(8_000n * TOKEN);
    expect((await position('bruno')).balance).toBe(7_000n * TOKEN);
    await recordInflow(world, 1_875n * USDC);
    expect(await accrued('ana')).toBe(1_800n * USDC);
    expect(await accrued('bruno')).toBe(1_200n * USDC);
    expect(await accrued('holding')).toBe(750n * USDC);
  });

  it('treats a transfer between the same owner as a no-op for the ledger', async () => {
    const before = await position('ana');
    await transferProfit('ana', 'ana', 1n * TOKEN);
    expect(await position('ana')).toEqual(before);
  });

  it('pays the claim once; a second claim is refused', async () => {
    const { world } = ctx;
    const ana = await holderAccounts(world.asset, world.keys.ana.address);
    const funds = await usdcBalance(world, ana.funds);
    await world.send([await claimDistributionInstruction(world.asset, world.keys.ana)]);
    expect((await usdcBalance(world, ana.funds)) - funds).toBe(1_800n * USDC);
    await expectCode(world.send([await claimDistributionInstruction(world.asset, world.keys.ana)]), CACHAIN_ERROR__NOTHING_TO_CLAIM);
  });

  it('keeps accruing for a frozen holder, who can claim only after reinstatement', async () => {
    const { world } = ctx;
    await world.send([
      await revokeInstruction(world.client.payer, world.keys.issuer, world.issuer.credential, world.issuer.schema, world.keys.bruno.address),
    ]);
    await world.client.sendTransaction(await freezeInstructions(world.asset, world.keys.bruno.address));
    await recordInflow(world, 1_875n * USDC);
    // bruno holds 7,000 of 18,750: 700 more while frozen.
    expect(await accrued('bruno')).toBe(1_900n * USDC);
    await expectCode(world.send([await claimDistributionInstruction(world.asset, world.keys.bruno)]), CACHAIN_ERROR__NOT_ELIGIBLE);
    await world.attest('bruno');
    await join(world, world.keys.bruno);
    await world.send([await claimDistributionInstruction(world.asset, world.keys.bruno)]);
  });

  it('never pays out more than was recorded', async () => {
    const { world } = ctx;
    await world.send([await claimDistributionInstruction(world.asset, world.keys.holding)]);
    await world.send([await claimDistributionInstruction(world.asset, world.keys.ana)]);
    const l = (await ledger(world)).ledger;
    expect(l.income).toBe(3n * 1_875n * USDC);
    expect(l.incomeClaimed <= l.income).toBe(true);
    // Everything recorded so far divides exactly, so everything was paid.
    expect(l.incomeClaimed).toBe(l.income);
    expect(await usdcBalance(world, world.asset.data.incomeVault)).toBe(0n);
  });
});
