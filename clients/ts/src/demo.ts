// Deterministic demo signers for localnet, derived from a public seed string so addresses in
// the documentation stay true across clones. Anyone can derive these keys: never fund them on
// a public cluster, and never use this in the production frontend (it signs with a wallet).
import { createKeyPairSignerFromPrivateKeyBytes, type KeyPairSigner } from '@solana/kit';

export const DEMO_SEED = 'founder-village-localnet-demo-v1';

export const DEMO_ROLES = [
  'creator', // pays for and creates the asset
  'issuer', // signs SAS attestations
  'councilA', // Squads members, 2-of-3
  'councilB',
  'councilC',
  'holding', // Founder Village Holding
  'operator', // Founder Haus LTDA: pays rent in
  'ana', // member, eligible
  'bruno', // member, eligible
  'eve', // not whitelisted
  'multisigKey', // Squads create key
  'speTreasury', // owner of the SPE's USDC account
  'usdcMint', // localnet stand-in for USDC
] as const;

export type DemoRole = (typeof DEMO_ROLES)[number];

// Kit refuses two signer objects for one address in a transaction, so each role is derived once.
const cache = new Map<string, Promise<KeyPairSigner>>();

export function demoSigner(role: DemoRole, seed = DEMO_SEED): Promise<KeyPairSigner> {
  const id = `${seed}:${role}`;
  let signer = cache.get(id);
  if (!signer) {
    signer = crypto.subtle
      .digest('SHA-256', new TextEncoder().encode(id))
      .then((digest) => createKeyPairSignerFromPrivateKeyBytes(new Uint8Array(digest)));
    cache.set(id, signer);
  }
  return signer;
}

export async function demoSigners(seed = DEMO_SEED): Promise<Record<DemoRole, KeyPairSigner>> {
  const entries = await Promise.all(DEMO_ROLES.map(async (r) => [r, await demoSigner(r, seed)] as const));
  return Object.fromEntries(entries) as Record<DemoRole, KeyPairSigner>;
}
