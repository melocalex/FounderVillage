// Test harness. One column, no design: every action shows its instruction, accounts, signature,
// state before and after, and the program error when it fails. It proves the program works and
// shows the production frontend the whole error surface. It is not a product.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { createClient, createNoopSigner, type Address, type Instruction, type TransactionSigner } from '@solana/kit';
import { walletWithoutSigner } from '@solana/kit-plugin-wallet';
import { getTransferCheckedWithTransferHookInstructionAsync } from '@solana-program/token-2022';
import {
  attestInstruction,
  BountyKind,
  BountyState,
  claimBountyInstruction,
  claimDistributionInstruction,
  contributeInstruction,
  councilAction,
  freezeInstructions,
  getAcceptDeliveryInstructionAsync,
  getCancelBountyInstructionAsync,
  getCloseFundingInstructionAsync,
  getCurateBountyInstructionAsync,
  getOpenBountyInstructionAsync,
  getPauseBountyInstructionAsync,
  getRejectDeliveryInstructionAsync,
  getResumeBountyInstructionAsync,
  getSubmitDeliveryInstructionAsync,
  holderAccounts,
  joinInstructions,
  proposeInstruction,
  recordInflowInstruction,
  revokeInstruction,
  settleWorkInstruction,
  type LoadedAsset,
} from '../../clients/ts/src';
import { demoSigners, type DemoRole } from '../../clients/ts/src/demo';
import {
  assertLocal,
  clientFor,
  holderView,
  json,
  listBounties,
  loadAssetState,
  loadLocalnet,
  plain,
  run,
  type Localnet,
  type LogEntry,
} from './harness';

const PERSONAS: DemoRole[] = ['ana', 'bruno', 'eve', 'operator', 'holding', 'councilA', 'councilB', 'councilC', 'issuer'];
const USDC = 1_000_000n;
const sha256 = async (s: string) => new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)));
const short = (a: string) => `${a.slice(0, 4)}…${a.slice(-4)}`;
const pre = { fontSize: 12, background: '#f6f6f6', padding: 8, overflowX: 'auto' as const, margin: 0 };

type Bounty = Awaited<ReturnType<typeof listBounties>>[number];
type Pending = { label: string; action: Awaited<ReturnType<typeof councilAction>>; approvals: string[] };

export function App() {
  const [net, setNet] = useState<Localnet>();
  const [keys, setKeys] = useState<Record<DemoRole, TransactionSigner>>();
  const [who, setWho] = useState<DemoRole>('ana');
  const [wallet, setWallet] = useState<TransactionSigner | null>(null);
  const [asset, setAsset] = useState<LoadedAsset>();
  const [bounties, setBounties] = useState<Bounty[]>([]);
  const [selected, setSelected] = useState<Address>();
  const [view, setView] = useState<unknown>();
  const [log, setLog] = useState<LogEntry[]>([]);
  const [pending, setPending] = useState<Pending>();
  const [fatal, setFatal] = useState<string>();
  const [amount, setAmount] = useState('1000');
  const [busy, setBusy] = useState(false);

  const actor = wallet ?? keys?.[who];
  const read = useMemo(() => (net && actor ? clientFor(net, actor) : undefined), [net, actor]);

  const refresh = useCallback(async () => {
    if (!net || !read || !actor) return;
    const a = await loadAssetState(read, net);
    setAsset(a);
    const list = await listBounties(read, a);
    setBounties(list);
    setSelected((s) => s ?? list[0]?.address);
    setView(await holderView(read, a, actor.address));
  }, [net, read, actor]);

  useEffect(() => {
    (async () => {
      const n = await loadLocalnet();
      const k = await demoSigners();
      await assertLocal(clientFor(n, k.ana));
      setNet(n);
      setKeys(k);
    })().catch((e) => setFatal(String(e)));
  }, []);
  useEffect(() => {
    refresh().catch((e) => setFatal(String(e)));
  }, [refresh]);

  const bounty = bounties.find((b) => b.address === selected);

  /** Sends instructions as `as`, logs the outcome with state before and after. */
  const send = async (label: string, build: () => Promise<Instruction[]>, as: TransactionSigner | undefined = actor) => {
    if (!net || !as || !asset || !read) return;
    setBusy(true);
    try {
      const instructions = await build();
      const observe = async () =>
        json({
          asset: plain((await loadAssetState(read, net)).data),
          bounty: selected ? (await listBounties(read, asset)).find((b) => b.address === selected) : undefined,
          holder: await holderView(read, asset, as.address),
        });
      const entry = await run(net, as, label, instructions, observe);
      setLog((l) => [entry, ...l]);
      await refresh();
      return entry;
    } catch (e) {
      setLog((l) => [{ label, signer: as.address, instructions: [], error: { name: 'client error', message: String(e) } }, ...l]);
    } finally {
      setBusy(false);
    }
  };

  /** Starts a council action: the current persona proposes and records its own approval. */
  const propose = async (label: string, ix: () => Promise<Instruction>) => {
    if (!net || !read || !actor) return;
    const action = await councilAction(read.rpc, net.multisig, [await ix()], actor);
    const entry = await send(`council: propose ${label}`, async () => action.propose);
    if (entry && !entry.error) setPending({ label, action, approvals: [actor.address] });
  };

  const council = () => ({ council: createNoopSigner(net!.council), asset: asset!.address, bounty: selected! });

  const connectWallet = async () => {
    const c = createClient().use(walletWithoutSigner({ chain: 'solana:localnet' }));
    const { wallets } = c.wallet.getState();
    if (!wallets.length) return setFatal('No Wallet Standard wallet advertises solana:localnet. Use the demo personas here; use a wallet on devnet.');
    await c.wallet.connect(wallets[0]!);
    const { connected } = c.wallet.getState();
    if (!connected?.signer) return setFatal('The wallet connected without a signer (read-only).');
    if (!connected.supportedTransactionVersions.has(1)) return setFatal('This wallet cannot sign transaction v1; the production app falls back to a version 0 client.');
    setWallet(connected.signer as unknown as TransactionSigner);
  };

  if (fatal) return <pre style={{ ...pre, color: '#a00' }}>{fatal}</pre>;
  if (!net || !keys || !asset) return <p>Loading localnet…</p>;
  const a = asset.data;

  return (
    <main style={{ fontFamily: 'ui-monospace, monospace', maxWidth: 960, margin: '0 auto', padding: 16 }}>
      <h1 style={{ fontSize: 18 }}>Cachain test harness (localnet)</h1>
      <p style={{ background: '#fff3cd', padding: 8, fontSize: 13 }}>
        Demo personas sign with keys derived from a public seed. They exist only in this harness and refuse to run against
        mainnet, devnet or testnet. The production frontend signs with a wallet.
      </p>

      <section>
        <h2 style={{ fontSize: 15 }}>Acting as</h2>
        {PERSONAS.map((p) => (
          <button key={p} disabled={busy} onClick={() => (setWallet(null), setWho(p))} style={{ fontWeight: !wallet && who === p ? 'bold' : undefined, marginRight: 4 }}>
            {p}
          </button>
        ))}
        <button onClick={connectWallet} disabled={busy}>connect wallet</button>
        <pre style={pre}>{JSON.stringify(view, null, 2)}</pre>
      </section>

      <section>
        <h2 style={{ fontSize: 15 }}>Asset {asset.address}</h2>
        <pre style={pre}>{JSON.stringify(json({ ledger: a.ledger, distribution: a.distribution, council: a.council, holding: a.holding, holdingBps: a.holdingBps, ownershipMint: a.ownershipMint, profitMint: a.profitMint }), null, 2)}</pre>
      </section>

      <section>
        <h2 style={{ fontSize: 15 }}>Bounties</h2>
        <table style={{ fontSize: 12, borderCollapse: 'collapse', width: '100%' }}>
          <tbody>
            {bounties.map((b) => (
              <tr key={b.address} onClick={() => setSelected(b.address)} style={{ cursor: 'pointer', background: b.address === selected ? '#e8f0ff' : undefined }}>
                <td>#{String(b.id)}</td>
                <td>{BountyKind[b.kind]}</td>
                <td>{BountyState[b.state]}</td>
                <td>{b.title}</td>
                <td>{b.kind === BountyKind.Financial ? `${b.raised / USDC} / ${b.terms.target / USDC} USDC` : `reward ${b.terms.reward / USDC}`}</td>
                <td>{short(b.address)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section>
        <h2 style={{ fontSize: 15 }}>Actions</h2>
        <label>
          amount (USDC or tokens) <input value={amount} onChange={(e) => setAmount(e.target.value)} size={10} />
        </label>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 8 }}>
          <button disabled={busy} onClick={() => send('join: open position + thaw', () => joinInstructions(read!.rpc, asset, actor!.address, actor!))}>join (thaw)</button>
          <button disabled={busy || !bounty} onClick={() => send('contribute', async () => [await contributeInstruction(asset, selected!, actor!, BigInt(amount) * USDC, BigInt(Date.now()))])}>fund selected bounty</button>
          <button disabled={busy} onClick={() => send('propose work bounty', async () => [await proposeInstruction(asset, actor!, BountyKind.Work, `Work bounty ${a.nextBountyId}`, await sha256(String(Date.now())))])}>propose work bounty</button>
          <button disabled={busy} onClick={() => send('propose financial bounty', async () => [await proposeInstruction(asset, actor!, BountyKind.Financial, `Tranche ${a.nextBountyId}`, await sha256(String(Date.now())))])}>propose financial bounty</button>
          <button disabled={busy || !bounty} onClick={() => send('claim bounty', async () => [await claimBountyInstruction(asset, selected!, actor!)])}>claim work bounty</button>
          <button disabled={busy || !bounty} onClick={() => send('submit delivery', async () => [await getSubmitDeliveryInstructionAsync({ claimant: actor!, bounty: selected!, deliveryHash: await sha256(`delivery ${Date.now()}`) })])}>submit delivery</button>
          <button disabled={busy || !bounty} onClick={() => send('settle work', async () => [await settleWorkInstruction(asset, selected!, bounty!.claimant)])}>settle work</button>
          <button disabled={busy} onClick={() => send('record inflow', async () => [await recordInflowInstruction(asset, actor!, BigInt(amount) * USDC)])}>record inflow (rent)</button>
          <button disabled={busy} onClick={() => send('claim distribution', async () => [await claimDistributionInstruction(asset, actor!)])}>claim distribution</button>
          {(['ana', 'bruno', 'eve'] as DemoRole[]).map((to) => (
            <button key={to} disabled={busy} onClick={() => send(`transfer profit tokens to ${to}`, async () => {
              const from = await holderAccounts(asset, actor!.address);
              const dest = await holderAccounts(asset, keys[to].address);
              return [await getTransferCheckedWithTransferHookInstructionAsync(read!, { source: from.profit, mint: a.profitMint, destination: dest.profit, authority: actor!, amount: BigInt(amount) * USDC, decimals: a.decimals })];
            })}>send FHP to {to}</button>
          ))}
        </div>

        <h3 style={{ fontSize: 13 }}>Issuer and enforcement</h3>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
          {(['ana', 'bruno', 'eve'] as DemoRole[]).map((p) => (
            <span key={p}>
              <button disabled={busy} onClick={() => send(`attest ${p}`, async () => [await attestInstruction(keys.issuer, keys.issuer, a.credential, a.schema, keys[p].address, await sha256(`kyc:${p}`), 0n)], keys.issuer)}>attest {p}</button>
              <button disabled={busy} onClick={() => send(`revoke ${p}`, async () => [await revokeInstruction(keys.issuer, keys.issuer, a.credential, a.schema, keys[p].address)], keys.issuer)}>revoke {p}</button>
              <button disabled={busy} onClick={() => send(`freeze ${p} (anyone)`, () => freezeInstructions(asset, keys[p].address))}>freeze {p}</button>
            </span>
          ))}
        </div>

        <h3 style={{ fontSize: 13 }}>Council (2-of-3 Squads vault {short(net.council)})</h3>
        <p style={{ fontSize: 12 }}>Act as councilA, B or C. One member proposes, a second approves, any member executes.</p>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
          <button disabled={busy || !bounty} onClick={() => propose('curate', () => getCurateBountyInstructionAsync({ ...council(), terms: bounty!.kind === BountyKind.Work ? { reward: BigInt(amount) * USDC, priceNum: 0n, priceDen: 0n, target: 0n, deadline: 0n } : { reward: 0n, priceNum: 1n, priceDen: 1n, target: BigInt(amount) * USDC, deadline: 0n } }))}>curate (amount = reward or target)</button>
          <button disabled={busy || !bounty} onClick={() => propose('open', () => getOpenBountyInstructionAsync(council()))}>open</button>
          <button disabled={busy || !bounty} onClick={() => propose('accept delivery', () => getAcceptDeliveryInstructionAsync(council()))}>accept</button>
          <button disabled={busy || !bounty} onClick={() => propose('reject delivery', () => getRejectDeliveryInstructionAsync(council()))}>reject</button>
          <button disabled={busy || !bounty} onClick={() => propose('pause', () => getPauseBountyInstructionAsync(council()))}>pause</button>
          <button disabled={busy || !bounty} onClick={() => propose('resume', () => getResumeBountyInstructionAsync(council()))}>resume</button>
          <button disabled={busy || !bounty} onClick={() => propose('close funding', () => getCloseFundingInstructionAsync(council()))}>close funding</button>
          <button disabled={busy || !bounty} onClick={() => propose('cancel', () => getCancelBountyInstructionAsync(council()))}>cancel</button>
          <button disabled={busy || !bounty} onClick={() => send('curate signed by one member (must fail)', async () => [await getCurateBountyInstructionAsync({ council: actor!, asset: asset.address, bounty: selected!, terms: { reward: 1n, priceNum: 0n, priceDen: 0n, target: 0n, deadline: 0n } })])}>try with one key</button>
        </div>
        {pending && (
          <p style={{ fontSize: 12 }}>
            Pending: <b>{pending.label}</b> (transaction #{String(pending.action.index)}), approved by {pending.approvals.map(short).join(', ')}{' '}
            <button disabled={busy} onClick={async () => {
              const e = await send(`council: approve ${pending.label}`, async () => [pending.action.approve(actor!)]);
              if (e && !e.error) setPending({ ...pending, approvals: [...pending.approvals, actor!.address] });
            }}>approve as {who}</button>{' '}
            <button disabled={busy} onClick={async () => {
              const e = await send(`council: execute ${pending.label}`, async () => [pending.action.execute(actor!)]);
              if (e && !e.error) setPending(undefined);
            }}>execute</button>
          </p>
        )}
      </section>

      <section>
        <h2 style={{ fontSize: 15 }}>Log</h2>
        {log.map((e, i) => (
          <details key={i} open={i === 0} style={{ borderTop: '1px solid #ddd', padding: '4px 0' }}>
            <summary style={{ color: e.error ? '#a00' : '#060' }}>
              {e.error ? '✗' : '✓'} {e.label} as {short(e.signer)}
              {e.error && ` — ${e.error.name}`}
              {e.signature && <> — <a href={e.explorer} target="_blank" rel="noreferrer">{short(e.signature)}</a></>}
            </summary>
            {e.error && <pre style={{ ...pre, color: '#a00' }}>{`code: ${e.error.code ?? '—'}\n${e.error.message}`}</pre>}
            <pre style={pre}>{JSON.stringify(e.instructions, null, 2)}</pre>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4 }}>
              <pre style={pre}>before {JSON.stringify(e.before, null, 2)}</pre>
              <pre style={pre}>after {JSON.stringify(e.after, null, 2)}</pre>
            </div>
          </details>
        ))}
      </section>
    </main>
  );
}
