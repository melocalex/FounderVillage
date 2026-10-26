import { beforeAll, describe, expect, it } from 'vitest';
import { fetchMint, fetchToken, AccountState, getMintDecoder } from '@solana-program/token-2022';
import { AssetStatus, fetchPosition } from '../clients/ts/src';
import { holderAccounts } from '../clients/ts/src/protocol';
import { litesvmWorld } from './setup';

describe('asset creation', () => {
  let ctx: Awaited<ReturnType<typeof litesvmWorld>>;
  beforeAll(async () => {
    ctx = await litesvmWorld();
  });

  it('is live with both mints, policy numbers from config, and the Squads vault as council', async () => {
    const { world } = ctx;
    const a = world.asset.data;
    expect(a.status).toBe(AssetStatus.Live);
    expect(a.holdingBps).toBe(2000);
    expect(a.council).toBe(world.council);
    expect(a.holding).toBe(world.keys.holding.address);
    expect(a.speTreasury).toBe(world.speTreasury);
  });

  it('creates mints frozen by default, with the asset PDA as mint and freeze authority', async () => {
    const { client, world } = ctx;
    for (const mint of [world.asset.data.ownershipMint, world.asset.data.profitMint]) {
      const m = await fetchMint(client.rpc, mint);
      expect(m.data.mintAuthority).toMatchObject({ value: world.asset.address });
      expect(m.data.freezeAuthority).toMatchObject({ value: world.asset.address });
      const kinds = (m.data.extensions as { __option: string; value?: { __kind: string }[] }).value?.map((e) => e.__kind);
      expect(kinds).toEqual(expect.arrayContaining(['DefaultAccountState', 'TransferHook', 'MetadataPointer', 'TokenMetadata']));
      expect(kinds).not.toContain('PermanentDelegate');
      expect(kinds).not.toContain('MintCloseAuthority');
    }
  });

  it('joined the holding: thawed accounts and an open position', async () => {
    const { client, world } = ctx;
    const h = await holderAccounts(world.asset, world.keys.holding.address);
    expect((await fetchToken(client.rpc, h.ownership)).data.state).toBe(AccountState.Initialized);
    expect((await fetchToken(client.rpc, h.profit)).data.state).toBe(AccountState.Initialized);
    expect((await fetchPosition(client.rpc, h.position)).data.balance).toBe(0n);
    void getMintDecoder;
  });
});
