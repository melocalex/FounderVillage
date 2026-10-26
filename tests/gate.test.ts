// Holding is gated, not just buying: an account can hold the asset only while its owner holds a
// live attestation, and anyone can enforce a revocation.
import { beforeAll, describe, expect, it } from 'vitest';
import { generateKeyPairSigner } from '@solana/kit';
import { getCreateAccountInstruction } from '@solana-program/system';
import {
  AccountState,
  fetchToken,
  getCreateAssociatedTokenIdempotentInstructionAsync,
  getInitializeAccount3Instruction,
  getTokenSize,
  getTransferCheckedWithTransferHookInstructionAsync,
  TOKEN_2022_PROGRAM_ADDRESS,
} from '@solana-program/token-2022';
import {
  FOUNDER_VILLAGE_ERROR__ALREADY_THAWED,
  FOUNDER_VILLAGE_ERROR__MUTABLE_OWNER,
  FOUNDER_VILLAGE_ERROR__ATTESTATION_EXPIRED,
  FOUNDER_VILLAGE_ERROR__ATTESTATION_WRONG_CREDENTIAL,
  FOUNDER_VILLAGE_ERROR__NOT_ELIGIBLE,
  FOUNDER_VILLAGE_ERROR__NOT_TRANSFERRING,
  FOUNDER_VILLAGE_ERROR__STILL_ELIGIBLE,
  FOUNDER_VILLAGE_ERROR__WRONG_ATTESTATION_ADDRESS,
  findExtraMetasPda,
  freezeInstructions,
  getExecuteInstructionAsync,
  getThawHolderInstructionAsync,
  holderAccounts,
  joinInstructions,
  revokeAndFreezeInstructions,
  revokeInstruction,
} from '../clients/ts/src';
import { USDC } from '../scripts/world';
import { contribute, holdings, join, stage2 } from './flow';
import { expectCode, litesvmWorld } from './setup';

const TOKEN_ERROR_ACCOUNT_FROZEN = 17;

describe('eligibility gate', () => {
  let ctx: Awaited<ReturnType<typeof litesvmWorld>>;
  let bounty: Awaited<ReturnType<typeof stage2>>;
  beforeAll(async () => {
    ctx = await litesvmWorld();
    const { world } = ctx;
    await join(world, world.keys.ana);
    await join(world, world.keys.bruno);
    bounty = await stage2(world);
    await contribute(world, bounty, world.keys.ana, 1_000n * USDC);
  });

  it('refuses to thaw a wallet with no attestation', async () => {
    const { world } = ctx;
    const ixs = await joinInstructions(world.client.rpc, world.asset, world.keys.eve.address, world.client.payer);
    await expectCode(world.send(ixs), FOUNDER_VILLAGE_ERROR__NOT_ELIGIBLE);
  });

  it('leaves a non-whitelisted account frozen, so it cannot receive the token', async () => {
    const { world } = ctx;
    const eve = await holderAccounts(world.asset, world.keys.eve.address);
    const ana = await holderAccounts(world.asset, world.keys.ana.address);
    await world.send([
      await getCreateAssociatedTokenIdempotentInstructionAsync({
        payer: world.client.payer,
        owner: world.keys.eve.address,
        mint: world.asset.data.ownershipMint,
        tokenProgram: TOKEN_2022_PROGRAM_ADDRESS,
      }),
    ]);
    expect((await fetchToken(world.client.rpc, eve.ownership)).data.state).toBe(AccountState.Frozen);
    const transfer = await getTransferCheckedWithTransferHookInstructionAsync(world.client, {
      source: ana.ownership,
      mint: world.asset.data.ownershipMint,
      destination: eve.ownership,
      authority: world.keys.ana,
      amount: 1n,
      decimals: 6,
    });
    await expectCode(world.send([transfer]), TOKEN_ERROR_ACCOUNT_FROZEN);
  });

  it("refuses to thaw a wallet presenting someone else's attestation", async () => {
    const { world } = ctx;
    const ana = await holderAccounts(world.asset, world.keys.ana.address);
    const eve = await holderAccounts(world.asset, world.keys.eve.address);
    const ix = await getThawHolderInstructionAsync({
      asset: world.asset.address,
      owner: world.keys.eve.address,
      mint: world.asset.data.ownershipMint,
      tokenAccount: eve.ownership,
      attestation: ana.attestation,
      credential: world.asset.data.credential,
    });
    await expectCode(world.send([ix]), FOUNDER_VILLAGE_ERROR__WRONG_ATTESTATION_ADDRESS);
  });

  it('refuses a credential other than the pinned one', async () => {
    const { world } = ctx;
    const ana = await holderAccounts(world.asset, world.keys.ana.address);
    const ix = await getThawHolderInstructionAsync({
      asset: world.asset.address,
      owner: world.keys.ana.address,
      mint: world.asset.data.ownershipMint,
      tokenAccount: ana.ownership,
      attestation: ana.attestation,
      credential: world.asset.data.schema,
    });
    await expectCode(world.send([ix]), FOUNDER_VILLAGE_ERROR__ATTESTATION_WRONG_CREDENTIAL);
  });

  it('refuses to thaw an account whose owner could later be reassigned', async () => {
    const { world } = ctx;
    // A plain (non-associated) Token-2022 account has no ImmutableOwner extension. If the gate
    // thawed it, Ana could hand the thawed account to Eve with SetAuthority.
    const account = await generateKeyPairSigner();
    const space = getTokenSize([{ __kind: 'TransferHookAccount', transferring: false }]);
    await world.send([
      getCreateAccountInstruction({
        payer: world.client.payer,
        newAccount: account,
        lamports: await world.client.getMinimumBalance(space),
        space,
        programAddress: TOKEN_2022_PROGRAM_ADDRESS,
      }),
      getInitializeAccount3Instruction({ account: account.address, mint: world.asset.data.ownershipMint, owner: world.keys.ana.address }),
    ]);
    const ana = await holderAccounts(world.asset, world.keys.ana.address);
    const ix = await getThawHolderInstructionAsync({
      asset: world.asset.address,
      owner: world.keys.ana.address,
      mint: world.asset.data.ownershipMint,
      tokenAccount: account.address,
      attestation: ana.attestation,
      credential: world.asset.data.credential,
    });
    await expectCode(world.send([ix]), FOUNDER_VILLAGE_ERROR__MUTABLE_OWNER);
  });

  it('refuses to thaw twice', async () => {
    const { world } = ctx;
    const ana = await holderAccounts(world.asset, world.keys.ana.address);
    const ix = await getThawHolderInstructionAsync({
      asset: world.asset.address,
      owner: world.keys.ana.address,
      mint: world.asset.data.ownershipMint,
      tokenAccount: ana.ownership,
      attestation: ana.attestation,
      credential: world.asset.data.credential,
    });
    await expectCode(world.send([ix]), FOUNDER_VILLAGE_ERROR__ALREADY_THAWED);
  });

  it('refuses to freeze a holder who is still eligible', async () => {
    const { world } = ctx;
    const [ix] = await freezeInstructions(world.asset, world.keys.ana.address);
    await expectCode(world.send([ix!]), FOUNDER_VILLAGE_ERROR__STILL_ELIGIBLE);
  });

  it('lets anyone freeze a revoked holder; the balance survives and buying stops', async () => {
    const { world } = ctx;
    const before = await holdings(world, world.keys.ana.address);
    await world.send([
      await revokeInstruction(world.client.payer, world.keys.issuer, world.issuer.credential, world.issuer.schema, world.keys.ana.address),
    ]);
    // freeze_holder needs no signer at all: any fee payer can enforce a revocation.
    await world.client.sendTransaction(await freezeInstructions(world.asset, world.keys.ana.address));
    const ana = await holderAccounts(world.asset, world.keys.ana.address);
    expect((await fetchToken(world.client.rpc, ana.ownership)).data.state).toBe(AccountState.Frozen);
    expect((await fetchToken(world.client.rpc, ana.profit)).data.state).toBe(AccountState.Frozen);
    expect(await holdings(world, world.keys.ana.address)).toEqual(before);
    await expectCode(contribute(world, bounty, world.keys.ana, 1n * USDC), FOUNDER_VILLAGE_ERROR__NOT_ELIGIBLE);
  });

  it('thaws again on reinstatement', async () => {
    const { world } = ctx;
    await world.attest('ana');
    await join(world, world.keys.ana);
    const ana = await holderAccounts(world.asset, world.keys.ana.address);
    expect((await fetchToken(world.client.rpc, ana.ownership)).data.state).toBe(AccountState.Initialized);
  });

  it('treats an expired attestation as ineligible', async () => {
    const { world, now, setTime } = ctx;
    const expiry = now() + 1_000n;
    await world.send([
      await revokeInstruction(world.client.payer, world.keys.issuer, world.issuer.credential, world.issuer.schema, world.keys.bruno.address),
    ]);
    await world.attest('bruno', expiry);
    await contribute(world, bounty, world.keys.bruno, 10n * USDC);
    setTime(expiry + 1n);
    await expectCode(contribute(world, bounty, world.keys.bruno, 10n * USDC), FOUNDER_VILLAGE_ERROR__ATTESTATION_EXPIRED);
    await world.client.sendTransaction(await freezeInstructions(world.asset, world.keys.bruno.address));
  });

  it('revokes and freezes in one transaction, leaving no window to move tokens', async () => {
    const { world } = ctx;
    await world.send(
      await revokeAndFreezeInstructions(world.asset, world.client.payer, world.keys.issuer, world.keys.ana.address),
    );
    const ana = await holderAccounts(world.asset, world.keys.ana.address);
    expect((await fetchToken(world.client.rpc, ana.ownership)).data.state).toBe(AccountState.Frozen);
    expect((await fetchToken(world.client.rpc, ana.profit)).data.state).toBe(AccountState.Frozen);
  });

  it('rejects the transfer hook when called outside a transfer', async () => {
    const { world } = ctx;
    const ana = await holderAccounts(world.asset, world.keys.ana.address);
    const holding = await holderAccounts(world.asset, world.keys.holding.address);
    const ix = await getExecuteInstructionAsync({
      source: ana.profit,
      mint: world.asset.data.profitMint,
      destination: holding.profit,
      authority: world.keys.ana.address,
      extraMetas: (await findExtraMetasPda({ profitMint: world.asset.data.profitMint }))[0],
      asset: world.asset.address,
      sourcePosition: ana.position,
      destinationPosition: holding.position,
      amount: 1_000_000_000n,
    });
    await expectCode(world.send([ix]), FOUNDER_VILLAGE_ERROR__NOT_TRANSFERRING);
  });
});
