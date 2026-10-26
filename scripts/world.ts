// Builds the Founder Haus world on any Kit client (LiteSVM in tests, Surfpool for the demo):
// a local USDC stand-in, the SAS issuer, a 2-of-3 Squads council, the asset with both mints,
// the holding joined, and members attested per the scenario. Policy numbers come from
// config/founder-haus.json.
import { readFileSync } from 'node:fs';
import {
  createNoopSigner,
  type Address,
  type GetAccountInfoApi,
  type GetMultipleAccountsApi,
  type Instruction,
  type InstructionPlan,
  type KeyPairSigner,
  type Lamports,
  type Rpc,
  type TransactionSigner,
} from '@solana/kit';
import {
  findAssociatedTokenPda,
  getCreateAssociatedTokenIdempotentInstructionAsync,
  getCreateMintInstructionPlan,
  getMintToATAInstructionPlanAsync,
  TOKEN_PROGRAM_ADDRESS,
} from '@solana-program/token';
import {
  attestInstruction,
  BountyKind,
  councilAction,
  createMultisigInstruction,
  findAssetPda,
  findBountyPda,
  findEventAuthorityPda,
  findMultisigPda,
  findVaultPda,
  getCreateAssetInstructionAsync,
  getCreateMintsInstructionAsync,
  getCurateBountyInstruction,
  getOpenBountyInstruction,
  joinInstructions,
  loadAsset,
  proposeInstruction,
  setupIssuerInstructions,
  type LoadedAsset,
} from '../clients/ts/src';
import { demoSigners, type DemoRole } from '../clients/ts/src/demo';

export const config = JSON.parse(readFileSync(new URL('../config/founder-haus.json', import.meta.url), 'utf8')) as {
  assetId: number;
  holdingBps: number;
  decimals: number;
  credentialName: string;
  ownership: { name: string; symbol: string; uri: string };
  profit: { name: string; symbol: string; uri: string };
  price: { tokensPerUsdcNum: number; tokensPerUsdcDen: number };
  tranches: { title: string; targetUsdc: number; deadline: string | null; open: boolean }[];
  workBounties: { title: string; rewardTokens: number }[];
};

export const USDC = 1_000_000n;
export const TOKEN = 10n ** BigInt(config.decimals);

export type WorldClient = {
  payer: TransactionSigner;
  rpc: Rpc<GetAccountInfoApi & GetMultipleAccountsApi>;
  sendTransaction: (input: Instruction | Instruction[] | InstructionPlan) => Promise<unknown>;
  getMinimumBalance: (space: number) => Promise<Lamports>;
};

export type World = Awaited<ReturnType<typeof buildWorld>>;

/** sha256 of a string, for spec and claim hashes in fixtures. */
export async function hash(label: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(label)));
}

export async function buildWorld(
  client: WorldClient,
  fund: (address: Address, lamports: bigint) => Promise<void> | void,
  options: { attest?: DemoRole[]; usdcFor?: DemoRole[] } = {},
) {
  const keys = await demoSigners();
  const send = (ixs: Instruction[]) => client.sendTransaction(ixs);
  const payers: DemoRole[] = ['creator', 'issuer', 'councilA', 'councilB', 'councilC', 'holding', 'operator', 'ana', 'bruno', 'eve'];
  for (const role of payers) await fund(keys[role].address, 100_000_000_000n);

  // Contribution token: a local stand-in for USDC (6 decimals, classic SPL Token).
  const usdc = keys.usdcMint.address;
  await client.sendTransaction(
    await getCreateMintInstructionPlan(client, {
      payer: client.payer,
      newMint: keys.usdcMint,
      decimals: 6,
      mintAuthority: keys.creator.address,
    }),
  );
  const usdcAta = async (owner: Address) =>
    (await findAssociatedTokenPda({ owner, mint: usdc, tokenProgram: TOKEN_PROGRAM_ADDRESS }))[0];
  for (const role of options.usdcFor ?? (['ana', 'bruno', 'eve', 'operator'] as DemoRole[])) {
    await client.sendTransaction(
      await getMintToATAInstructionPlanAsync({
        payer: client.payer,
        owner: keys[role].address,
        mint: usdc,
        mintAuthority: keys.creator,
        amount: 1_000_000n * USDC,
        decimals: 6,
      }),
    );
  }
  const speTreasury = await usdcAta(keys.speTreasury.address);
  // The SPE receives capital; the holding receives its share of rent.
  await send(
    await Promise.all(
      [keys.speTreasury, keys.holding].map((owner) =>
        getCreateAssociatedTokenIdempotentInstructionAsync({ payer: client.payer, owner: owner.address, mint: usdc }),
      ),
    ),
  );

  // Eligibility issuer: SAS credential and the member schema.
  const issuer = await setupIssuerInstructions(client.payer, keys.issuer, config.credentialName, [keys.issuer.address]);
  await send(issuer.instructions);

  // Council: a 2-of-3 Squads multisig; its vault PDA is the asset council.
  await send([
    await createMultisigInstruction(
      client.rpc,
      keys.councilA,
      keys.multisigKey,
      [keys.councilA.address, keys.councilB.address, keys.councilC.address],
      2,
    ),
  ]);
  const multisig = await findMultisigPda(keys.multisigKey.address);
  const council = await findVaultPda(multisig);

  // The asset and its two mints.
  const assetAddress = await findAssetPda(keys.creator.address, BigInt(config.assetId));
  await send([
    await getCreateAssetInstructionAsync({
      creator: keys.creator,
      asset: assetAddress,
      contributionMint: usdc,
      speTreasury,
      contributionTokenProgram: TOKEN_PROGRAM_ADDRESS,
      assetId: BigInt(config.assetId),
      council,
      holding: keys.holding.address,
      holdingBps: config.holdingBps,
      decimals: config.decimals,
      credential: issuer.credential,
      schema: issuer.schema,
    }),
  ]);
  await send([
    await getCreateMintsInstructionAsync({
      creator: keys.creator,
      asset: assetAddress,
      ownership: config.ownership,
      profit: config.profit,
    }),
  ]);
  let asset = await loadAsset(client.rpc, assetAddress);

  // Attestations: the holding is a whitelisted party like any member.
  const attest = async (role: DemoRole, expiry = 0n) =>
    send([
      await attestInstruction(
        client.payer,
        keys.issuer,
        issuer.credential,
        issuer.schema,
        keys[role].address,
        await hash(`kyc-record:${role}`),
        expiry,
      ),
    ]);
  await attest('holding');
  for (const role of options.attest ?? (['ana', 'bruno'] as DemoRole[])) await attest(role);
  await send(await joinInstructions(client.rpc, asset, keys.holding.address, client.payer));

  /** Runs instructions as the council: propose (A), approve (B), execute (A). */
  const asCouncil = async (instructions: Instruction[]) => {
    const action = await councilAction(client.rpc, multisig, instructions, keys.councilA);
    await send(action.propose);
    await send([action.approve(keys.councilB)]);
    await send([action.execute(keys.councilA)]);
  };

  const refresh = async () => (asset = await loadAsset(client.rpc, assetAddress));

  return {
    client,
    keys,
    usdc,
    usdcAta,
    speTreasury,
    issuer,
    multisig,
    council,
    get asset(): LoadedAsset {
      return asset;
    },
    refresh,
    attest,
    asCouncil,
    send,
  };
}

/** Proposes, curates and opens a bounty through the council. Returns its address. */
export async function openBounty(
  world: World,
  proposer: KeyPairSigner,
  kind: BountyKind,
  title: string,
  terms: { reward?: bigint; priceNum?: bigint; priceDen?: bigint; target?: bigint; deadline?: bigint },
) {
  await world.refresh();
  const bounty = await findBountyPda(world.asset.address, world.asset.data.nextBountyId);
  await world.send([await proposeInstruction(world.asset, proposer, kind, title, await hash(title))]);
  const common = { council: councilSigner(world), asset: world.asset.address, bounty };
  await world.asCouncil([
    getCurateBountyInstruction({
      ...common,
      eventAuthority: await eventAuthority(),
      terms: {
        reward: terms.reward ?? 0n,
        priceNum: terms.priceNum ?? 0n,
        priceDen: terms.priceDen ?? 0n,
        target: terms.target ?? 0n,
        deadline: terms.deadline ?? 0n,
      },
    }),
    getOpenBountyInstruction({ ...common, eventAuthority: await eventAuthority() }),
  ]);
  await world.refresh();
  return bounty;
}

export const eventAuthority = async () => (await findEventAuthorityPda())[0];

/** The council as an instruction signer. It is a vault PDA: Squads signs for it on execute. */
export const councilSigner = (world: Pick<World, 'council'>) => createNoopSigner(world.council);
