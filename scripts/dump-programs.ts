// Fetches the mainnet programs and accounts the local tests run against: Solana Attestation
// Service and Squads v4. Reads only. Files land in tests/fixtures (git-ignored) and their hashes
// are printed, so a change on mainnet shows up as a diff in the console, not as a silent drift.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { address, createSolanaRpc, getBase64Encoder, type Address } from '@solana/kit';

const RPC = process.env.MAINNET_RPC_URL ?? 'https://api.mainnet-beta.solana.com';
const OUT = 'tests/fixtures';
const PROGRAMDATA_HEADER = 45; // UpgradeableLoaderState::ProgramData: tag u32, slot u64, Option<Pubkey>

const programs: { name: string; programData: Address }[] = [
  // SAS 22zoJMtdu4tQc2PzL74ZUT7FrwgB1Udec8DdW4yw4BdG
  { name: 'sas', programData: address('HqaxR5hg8yYyuM5QPiWMhSAvXGWwfDBbvthvYpqMQ73v') },
  // Squads v4 SQDS4ep65T869zMMBKyuUq6aD6EgTu8psMjkvj52pCf (immutable on mainnet)
  { name: 'squads', programData: address('Fy3YMJCvwbAXUgUM5b91ucUVA3jYzwWLHL3MwBqKsh8n') },
];
// Squads ProgramConfig PDA ["multisig","program_config"]: multisig_create_v2 reads it.
const accounts: { name: string; address: Address }[] = [
  { name: 'squads-program-config', address: address('BSTq9w3kZwNwpBXJEvTZz2G9ZTNyKBvoSeXMvwb4cNZr') },
];

const rpc = createSolanaRpc(RPC);
const fetchData = async (key: Address) => {
  const { value } = await rpc.getAccountInfo(key, { encoding: 'base64' }).send();
  if (!value) throw new Error(`account ${key} not found on ${RPC}`);
  return { bytes: getBase64Encoder().encode(value.data[0]), info: value };
};

mkdirSync(OUT, { recursive: true });
for (const p of programs) {
  const file = `${OUT}/${p.name}.so`;
  if (existsSync(file) && !process.argv.includes('--force')) continue;
  const { bytes } = await fetchData(p.programData);
  const elf = bytes.slice(PROGRAMDATA_HEADER);
  writeFileSync(file, elf);
  console.log(`${file}  ${elf.length} bytes  sha256 ${createHash('sha256').update(elf).digest('hex')}`);
}
for (const a of accounts) {
  const file = `${OUT}/${a.name}.json`;
  if (existsSync(file) && !process.argv.includes('--force')) continue;
  const { bytes, info } = await fetchData(a.address);
  writeFileSync(
    file,
    JSON.stringify(
      {
        address: a.address,
        owner: info.owner,
        lamports: info.lamports.toString(),
        data: Buffer.from(bytes).toString('base64'),
      },
      null,
      2,
    ) + '\n',
  );
  console.log(`${file}  ${bytes.length} bytes`);
}
