// Financial bounties (tranches): capital in, claims minted in the same transaction, the holding's
// share on every issuance, and a vault that always matches its ledger.
import { beforeAll, describe, expect, it } from 'vitest';
import type { TransactionSigner } from '@solana/kit';
import { getTransferCheckedInstruction } from '@solana-program/token';
import {
  BountyKind,
  BountyState,
  CACHAIN_ERROR__DEADLINE_PASSED,
  CACHAIN_ERROR__EXCEEDS_CAPITAL,
  CACHAIN_ERROR__EXCEEDS_TARGET,
  CACHAIN_ERROR__FUNDS_RAISED,
  CACHAIN_ERROR__INVALID_BOUNTY_STATE,
  CACHAIN_ERROR__NOT_COUNCIL,
  CACHAIN_ERROR__WRONG_BOUNTY_KIND,
  CACHAIN_ERROR__ZERO_TOKENS,
  claimBountyInstruction,
  fetchBounty,
  getCancelBountyInstructionAsync,
  getCloseFundingInstructionAsync,
  getPauseBountyInstructionAsync,
  getRecordOutflowInstructionAsync,
  getResumeBountyInstructionAsync,
} from '../clients/ts/src';
import { config, councilSigner, openBounty, TOKEN, USDC } from '../scripts/world';
import { contribute, holdings, join, ledger, stage2, usdcBalance } from './flow';
import { expectCode, litesvmWorld } from './setup';

describe('financial bounties', () => {
  let ctx: Awaited<ReturnType<typeof litesvmWorld>>;
  let bounty: Awaited<ReturnType<typeof stage2>>;
  const council = () => ({ council: councilSigner(ctx.world), asset: ctx.world.asset.address, bounty });

  beforeAll(async () => {
    ctx = await litesvmWorld();
    await join(ctx.world, ctx.world.keys.ana);
    await join(ctx.world, ctx.world.keys.bruno);
    bounty = await stage2(ctx.world);
  });

  it('mints the claim in the same transaction as the USDC, at the curated price, plus the holding share', async () => {
    const { world } = ctx;
    const vaultBefore = await usdcBalance(world, world.asset.data.capitalVault);
    await contribute(world, bounty, world.keys.ana, 10_000n * USDC);
    const ana = await holdings(world, world.keys.ana.address);
    const holding = await holdings(world, world.keys.holding.address);
    expect(ana.ownership).toBe(10_000n * TOKEN);
    expect(ana.profit).toBe(10_000n * TOKEN);
    expect(ana.position.balance).toBe(10_000n * TOKEN);
    expect(holding.ownership).toBe(2_500n * TOKEN); // 20% of 12,500
    expect(await usdcBalance(world, world.asset.data.capitalVault)).toBe(vaultBefore + 10_000n * USDC);
    const b = await fetchBounty(world.client.rpc, bounty);
    expect(b.data.raised).toBe(10_000n * USDC);
  });

  it('keeps the holding at its share after mixed issuances (rounding below one base unit each)', async () => {
    const { world } = ctx;
    await contribute(world, bounty, world.keys.bruno, 3_333_333n); // 3.333333 USDC
    await contribute(world, bounty, world.keys.ana, 7n);
    await contribute(world, bounty, world.keys.bruno, 1_234n * USDC + 1n);
    const ana = await holdings(world, world.keys.ana.address);
    const bruno = await holdings(world, world.keys.bruno.address);
    const holding = await holdings(world, world.keys.holding.address);
    const total = ana.ownership + bruno.ownership + holding.ownership;
    const exact = (total * BigInt(config.holdingBps)) / 10_000n;
    expect(holding.ownership <= exact).toBe(true);
    expect(exact - holding.ownership <= 4n).toBe(true); // four issuances, under one unit each
  });

  it('refuses a contribution above the remaining target', async () => {
    const { world } = ctx;
    const target = BigInt(config.tranches[0]!.targetUsdc) * USDC;
    await expectCode(contribute(world, bounty, world.keys.ana, target), CACHAIN_ERROR__EXCEEDS_TARGET);
  });

  it('pauses and resumes contributions through the council', async () => {
    const { world } = ctx;
    await world.asCouncil([await getPauseBountyInstructionAsync(council())]);
    expect((await fetchBounty(world.client.rpc, bounty)).data.state).toBe(BountyState.Paused);
    await expectCode(contribute(world, bounty, world.keys.ana, USDC), CACHAIN_ERROR__INVALID_BOUNTY_STATE);
    await world.asCouncil([await getResumeBountyInstructionAsync(council())]);
    await contribute(world, bounty, world.keys.ana, USDC);
  });

  it('refuses pause, resume or close from a single council member', async () => {
    const { world } = ctx;
    const single = { council: world.keys.councilA, asset: world.asset.address, bounty };
    await expectCode(world.send([await getPauseBountyInstructionAsync(single)]), CACHAIN_ERROR__NOT_COUNCIL);
    await expectCode(world.send([await getResumeBountyInstructionAsync(single)]), CACHAIN_ERROR__NOT_COUNCIL);
    await expectCode(world.send([await getCloseFundingInstructionAsync(single)]), CACHAIN_ERROR__NOT_COUNCIL);
  });

  it('refuses cancellation once capital is raised', async () => {
    const { world } = ctx;
    await expectCode(world.asCouncil([await getCancelBountyInstructionAsync(council())]), CACHAIN_ERROR__FUNDS_RAISED);
  });

  it('refuses work-bounty actions on a financial bounty', async () => {
    const { world } = ctx;
    await expectCode(
      world.send([await claimBountyInstruction(world.asset, bounty, world.keys.bruno)]),
      CACHAIN_ERROR__WRONG_BOUNTY_KIND,
    );
  });

  it('refuses a contribution so small it buys nothing', async () => {
    const { world } = ctx;
    const tiny = await openBounty(world, world.keys.ana, BountyKind.Financial, 'Tiny price', {
      priceNum: 1n,
      priceDen: 1_000n,
      target: 1_000n * USDC,
    });
    await expectCode(contribute(world, tiny, world.keys.ana, 999n), CACHAIN_ERROR__ZERO_TOKENS);
  });

  it('refuses contributions after the deadline', async () => {
    const { world, now, setTime } = ctx;
    const deadline = now() + 3_600n;
    const timed = await openBounty(world, world.keys.ana, BountyKind.Financial, 'Timed tranche', {
      priceNum: 1n,
      priceDen: 1n,
      target: 1_000n * USDC,
      deadline,
    });
    await contribute(world, timed, world.keys.ana, USDC);
    setTime(deadline + 1n);
    await expectCode(contribute(world, timed, world.keys.ana, USDC), CACHAIN_ERROR__DEADLINE_PASSED);
  });

  it('keeps the vault equal to contributions minus recorded outflows, ignoring stray transfers', async () => {
    const { world } = ctx;
    const outflow = (amount: bigint, council: TransactionSigner = councilSigner(world)) =>
      getRecordOutflowInstructionAsync({
        council,
        asset: world.asset.address,
        contributionMint: world.usdc,
        capitalVault: world.asset.data.capitalVault,
        speTreasury: world.speTreasury,
        contributionTokenProgram: world.asset.data.contributionTokenProgram,
        amount,
        memoHash: new Uint8Array(32).fill(7),
      });
    await world.asCouncil([await outflow(3_000n * USDC)]);
    const l = await ledger(world);
    expect(await usdcBalance(world, world.asset.data.capitalVault)).toBe(l.ledger.contributed - l.ledger.outflow);
    expect(await usdcBalance(world, world.speTreasury)).toBe(3_000n * USDC);

    // A plain transfer into the vault changes no accounting.
    await world.send([
      getTransferCheckedInstruction({
        source: await world.usdcAta(world.keys.eve.address),
        mint: world.usdc,
        destination: world.asset.data.capitalVault,
        authority: world.keys.eve,
        amount: 5n * USDC,
        decimals: 6,
      }),
    ]);
    expect((await ledger(world)).ledger).toEqual(l.ledger);

    await expectCode(world.asCouncil([await outflow(l.ledger.contributed)]), CACHAIN_ERROR__EXCEEDS_CAPITAL);
    // One council member alone is not the council.
    await expectCode(world.send([await outflow(USDC, world.keys.councilA)]), CACHAIN_ERROR__NOT_COUNCIL);
  });

  it('closes the tranche, after which nothing more can be raised', async () => {
    const { world } = ctx;
    await world.asCouncil([await getCloseFundingInstructionAsync(council())]);
    expect((await fetchBounty(world.client.rpc, bounty)).data.state).toBe(BountyState.Settled);
    await expectCode(contribute(world, bounty, world.keys.ana, USDC), CACHAIN_ERROR__INVALID_BOUNTY_STATE);
  });
});
