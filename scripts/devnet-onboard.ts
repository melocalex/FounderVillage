// `npm run devnet:onboard -- <wallet>`: gives a tester's wallet what the devnet demo needs.
//
// Puts the wallet on the whitelist (an attestation signed by the devnet issuer) and mints it
// 10,000 test USDC (the stand-in mint, no value). Run it after `devnet:seed`, on the machine
// that holds .devnet/seed. Safe to run twice: an existing attestation is kept.
import { address } from '@solana/kit';
import { getMintToATAInstructionPlanAsync } from '@solana-program/token';
import { findAttestationPda } from '@solana/attestation';
import { attestInstruction, issuerAddresses } from '../clients/ts/src';
import { demoSigners } from '../clients/ts/src/demo';
import { client, devnetClient, devnetSeed } from './devnet-client';
import { config, hash, USDC } from './world';

const arg = process.argv[2];
if (!arg) throw new Error('usage: npm run devnet:onboard -- <wallet address>');
const wallet = address(arg);
const AMOUNT = 10_000n * USDC;

const keys = await demoSigners(devnetSeed(false));
const { credential, schema } = await issuerAddresses(keys.issuer.address, config.credentialName);

const [attestation] = await findAttestationPda({ credential, schema, nonce: wallet });
const { value } = await client.rpc.getAccountInfo(attestation, { encoding: 'base64' }).send();
if (value) {
  console.log(`▸ ${wallet} is already on the whitelist`);
} else {
  await devnetClient.sendTransaction([
    await attestInstruction(client.payer, keys.issuer, credential, schema, wallet, await hash(`devnet-tester:${wallet}`), 0n),
  ]);
  console.log(`▸ ${wallet} is on the whitelist`);
}

await devnetClient.sendTransaction(
  await getMintToATAInstructionPlanAsync({
    payer: client.payer,
    owner: wallet,
    mint: keys.usdcMint.address,
    mintAuthority: keys.creator,
    amount: AMOUNT,
    decimals: 6,
  }),
);
console.log(`▸ minted 10,000 test USDC (${keys.usdcMint.address}) to ${wallet}`);
console.log(`  https://explorer.solana.com/address/${wallet}?cluster=devnet`);
