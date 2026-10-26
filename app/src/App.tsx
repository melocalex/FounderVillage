// Test harness. It proves the program works and shows the production frontend the whole error
// surface: every action logs its instructions, signature, what changed on-chain, and the program
// error when it fails. Nothing here is product UI.
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
  revokeAndFreezeInstructions,
  settleWorkInstruction,
  type LoadedAsset,
} from '../../clients/ts/src';
import { demoSigners, type DemoRole } from '../../clients/ts/src/demo';
import {
  assertLocal,
  clientFor,
  fmt,
  holderState,
  json,
  listBounties,
  loadAssetState,
  loadLocalnet,
  proposalState,
  run,
  short,
  units,
  vaultBalances,
  type Bounty,
  type HolderState,
  type Localnet,
  type LogEntry,
} from './harness';

type Persona = { role: DemoRole; label: string; blurb: string; council?: boolean };
const PERSONAS: Persona[] = [
  { role: 'ana', label: 'Ana', blurb: 'member, verified' },
  { role: 'bruno', label: 'Bruno', blurb: 'member, verified' },
  { role: 'eve', label: 'Eve', blurb: 'not on the whitelist' },
  { role: 'operator', label: 'Operator', blurb: 'pays rent in' },
  { role: 'holding', label: 'Holding', blurb: 'receives its share' },
  { role: 'councilA', label: 'Council A', blurb: 'Squads member', council: true },
  { role: 'councilB', label: 'Council B', blurb: 'Squads member', council: true },
  { role: 'councilC', label: 'Council C', blurb: 'Squads member', council: true },
  { role: 'issuer', label: 'Issuer', blurb: 'attests and revokes' },
];
const MEMBERS: DemoRole[] = ['ana', 'bruno', 'eve'];
const sha256 = async (s: string) => new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)));
const STATE_TONE: Record<string, string> = {
  Proposed: 'muted', Curated: 'info', Open: 'good', Paused: 'warn', Claimed: 'info',
  Delivered: 'info', Accepted: 'good', Rejected: 'bad', Settled: 'done', Cancelled: 'muted',
};

type Pending = { id: number; label: string; bounty: Address; action: Awaited<ReturnType<typeof councilAction>>; status?: string; approved: Address[] };

export function App() {
  const [net, setNet] = useState<Localnet>();
  const [keys, setKeys] = useState<Record<DemoRole, TransactionSigner>>();
  const [who, setWho] = useState<DemoRole>('ana');
  const [wallet, setWallet] = useState<TransactionSigner | null>(null);
  const [asset, setAsset] = useState<LoadedAsset>();
  const [vaults, setVaults] = useState({ capital: 0n, income: 0n });
  const [people, setPeople] = useState<Partial<Record<DemoRole, HolderState>>>({});
  const [me, setMe] = useState<HolderState>();
  const [bounties, setBounties] = useState<Bounty[]>([]);
  const [pending, setPending] = useState<Pending[]>([]);
  const [log, setLog] = useState<LogEntry[]>([]);
  const [busy, setBusy] = useState(false);
  const [fatal, setFatal] = useState<string>();
  const [toast, setToast] = useState<LogEntry>();

  const actor = wallet ?? keys?.[who];
  const read = useMemo(() => (net && keys ? clientFor(net, keys.ana) : undefined), [net, keys]);
  const nameOf = useCallback(
    (a: Address) => (keys ? PERSONAS.find((p) => keys[p.role].address === a)?.label : undefined) ?? (a === net?.council ? 'Council vault' : short(a)),
    [keys, net],
  );

  const refresh = useCallback(async () => {
    if (!net || !read || !keys) return;
    const a = await loadAssetState(read, net);
    setAsset(a);
    setVaults(await vaultBalances(read, a));
    setBounties(await listBounties(read, a));
    const states = await Promise.all(MEMBERS.concat('operator', 'holding').map(async (r) => [r, await holderState(read, a, keys[r].address)] as const));
    setPeople(Object.fromEntries(states));
    if (actor) setMe(await holderState(read, a, actor.address));
    setPending(await Promise.all(pendingRef.current.map(async (p) => ({ ...p, ...((await proposalState(read, p.action.proposal)) ?? {}) }))));
  }, [net, read, keys, actor]);

  // Pending council actions live in a ref so refresh() always sees the latest list.
  const pendingRef = useMemo(() => ({ current: [] as Pending[] }), []);
  useEffect(() => {
    pendingRef.current = pending;
  }, [pending, pendingRef]);

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

  /** Sends instructions as `as` and logs what changed. */
  const send = async (label: string, build: () => Promise<Instruction[]>, as: TransactionSigner | undefined = actor) => {
    if (!net || !as || !asset || !read || !keys) return;
    setBusy(true);
    try {
      const instructions = await build();
      const observe = async () => {
        const a = await loadAssetState(read, net);
        return {
          ledger: a.data.ledger,
          distribution: a.data.distribution,
          vaults: await vaultBalances(read, a),
          bounties: Object.fromEntries((await listBounties(read, a)).map((b) => [`#${b.id}`, { state: BountyState[b.state], raised: b.raised, claimant: b.claimant }])),
          [nameOf(as.address)]: await holderState(read, a, as.address),
        };
      };
      const entry = await run(net, as, label, instructions, observe);
      setLog((l) => [entry, ...l]);
      setToast(entry);
      await refresh();
      return entry;
    } catch (e) {
      const entry: LogEntry = { id: Date.now(), at: new Date(), label, signer: as.address, instructions: [], changes: [], error: { name: 'client error', message: String(e) } };
      setLog((l) => [entry, ...l]);
      setToast(entry);
    } finally {
      setBusy(false);
    }
  };

  /** Starts a council action: the acting persona proposes it and records its own approval. */
  const propose = async (label: string, bounty: Address, ix: () => Promise<Instruction>) => {
    if (!net || !read || !actor) return;
    const action = await councilAction(read.rpc, net.multisig, [await ix()], actor);
    const entry = await send(`council · propose ${label}`, async () => action.propose);
    if (entry && !entry.error) setPending((p) => [...p, { id: Date.now(), label, bounty, action, approved: [actor.address] }]);
  };

  const council = (bounty: Address) => ({ council: createNoopSigner(net!.council), asset: asset!.address, bounty });

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

  if (fatal) return <div className="fatal">{fatal}</div>;
  if (!net || !keys || !asset || !actor) return <div className="loading">Starting the harness…</div>;
  const a = asset.data;
  const persona = PERSONAS.find((p) => p.role === who)!;
  const actorName = wallet ? 'Wallet' : persona.label;

  return (
    <div className="app">
      <header className="top">
        <div className="brand">
          <span className="logo">◆</span> Cachain <span className="sub">test harness</span>
        </div>
        <div className="chips">
          <span className="chip good">localnet · Surfpool</span>
          <span className="chip" title={asset.address}>asset {short(asset.address)}</span>
          <span className="chip" title={net.council}>council {short(net.council)}</span>
          <button className="ghost" onClick={() => refresh()} disabled={busy}>↻ refresh</button>
        </div>
      </header>
      <p className="notice">
        Demo personas sign with keys from a public seed, only on a local cluster. The production frontend signs with a wallet and uses the same calls: see <code>AGENTS.md</code>.
      </p>

      <div className="layout">
        <aside className="col personas">
          <h2>Act as</h2>
          {PERSONAS.map((p) => {
            const s = people[p.role];
            const active = !wallet && who === p.role;
            return (
              <button key={p.role} className={`persona ${active ? 'active' : ''}`} onClick={() => (setWallet(null), setWho(p.role))} disabled={busy}>
                <span className="avatar">{p.label[0]}</span>
                <span className="who">
                  <b>{p.label}</b>
                  <small>{p.blurb}</small>
                  {s && (
                    <span className="badges">
                      <Badge tone={s.attestation.status === 'verified' ? 'good' : s.attestation.status === 'expired' ? 'warn' : 'bad'}>
                        {s.attestation.status === 'none' ? 'not verified' : s.attestation.status}
                      </Badge>
                      {s.profit.state !== 'none' && <Badge tone={s.profit.state === 'thawed' ? 'good' : 'warn'}>{s.profit.state}</Badge>}
                    </span>
                  )}
                </span>
              </button>
            );
          })}
          <button className="persona" onClick={connectWallet} disabled={busy}>
            <span className="avatar">W</span>
            <span className="who"><b>Connect wallet</b><small>Wallet Standard, needs tx v1</small></span>
          </button>
        </aside>

        <main className="col main">
          <section className="stats">
            <Stat label="Capital raised" value={`${fmt(a.ledger.contributed)} USDC`} hint={`vault ${fmt(vaults.capital)} · sent to SPV ${fmt(a.ledger.outflow)}`} />
            <Stat label="Rent recorded" value={`${fmt(a.ledger.income)} USDC`} hint={`claimed ${fmt(a.ledger.incomeClaimed)} · vault ${fmt(vaults.income)}`} />
            <Stat label="Profit tokens tracked" value={fmt(a.distribution.trackedSupply)} hint={`reward index ${a.distribution.rewardIndex.toString()}`} />
            <Stat label="Holding share" value={`${a.holdingBps / 100}%`} hint="of every issuance" />
          </section>

          <section className="card you">
            <div className="card-head">
              <h2>{actorName}</h2>
              <span className="mono">{short(actor.address)}</span>
            </div>
            {me && (
              <>
                <div className="facts">
                  <Fact label="Whitelist" value={me.attestation.status === 'none' ? 'not verified' : me.attestation.status} tone={me.attestation.status === 'verified' ? 'good' : 'bad'} />
                  <Fact label="Ownership (FHO)" value={me.ownership.state === 'none' ? 'no account' : `${fmt(me.ownership.amount)} · ${me.ownership.state}`} tone={me.ownership.state === 'thawed' ? 'good' : 'warn'} />
                  <Fact label="Profit (FHP)" value={me.profit.state === 'none' ? 'no account' : `${fmt(me.profit.amount)} · ${me.profit.state}`} tone={me.profit.state === 'thawed' ? 'good' : 'warn'} />
                  <Fact label="USDC" value={fmt(me.usdc)} />
                  <Fact label="Claimable rent" value={`${fmt(me.claimable)} USDC`} tone={me.claimable > 0n ? 'good' : undefined} />
                </div>
                <div className="actions">
                  <button disabled={busy} onClick={() => send('join: open position, thaw both accounts', () => joinInstructions(read!.rpc, asset, actor.address, actor))}>Join (thaw accounts)</button>
                  <button disabled={busy} onClick={() => send('claim distribution', async () => [await claimDistributionInstruction(asset, actor)])}>Claim rent</button>
                  <AmountAction label="Send FHP to" options={MEMBERS.filter((m) => keys[m].address !== actor.address)} busy={busy} onRun={async (amount, to) => {
                    await send(`send ${amount} FHP to ${to}`, async () => {
                      const from = await holderAccounts(asset, actor.address);
                      const dest = await holderAccounts(asset, keys[to as DemoRole].address);
                      return [await getTransferCheckedWithTransferHookInstructionAsync(read!, { source: from.profit, mint: a.profitMint, destination: dest.profit, authority: actor, amount: units(amount), decimals: a.decimals })];
                    });
                  }} />
                </div>
              </>
            )}
          </section>

          <section className="card">
            <div className="card-head">
              <h2>Bounties</h2>
              <ProposeForm busy={busy} onPropose={(kind, title, spec) => send(`propose ${BountyKind[kind].toLowerCase()} bounty`, async () => [await proposeInstruction(asset, actor, kind, title, await sha256(spec))])} />
            </div>
            <div className="board">
              {bounties.map((b) => (
                <BountyCard key={b.address} b={b} busy={busy} actor={actor} nameOf={nameOf}
                  onFund={(amt) => send(`contribute ${amt} USDC to #${b.id}`, async () => [await contributeInstruction(asset, b.address, actor, units(amt), BigInt(Date.now()))])}
                  onClaim={() => send(`claim bounty #${b.id}`, async () => [await claimBountyInstruction(asset, b.address, actor)])}
                  onDeliver={(text) => send(`submit delivery for #${b.id}`, async () => [await getSubmitDeliveryInstructionAsync({ claimant: actor, bounty: b.address, deliveryHash: await sha256(text) })])}
                  onSettle={() => send(`settle work #${b.id}`, async () => [await settleWorkInstruction(asset, b.address, b.claimant)])}
                  onCouncil={(label, ix) => propose(`${label} #${b.id}`, b.address, ix)}
                  onSingleKey={() => send(`curate #${b.id} with one key (must fail)`, async () => [await getCurateBountyInstructionAsync({ council: actor, asset: asset.address, bounty: b.address, terms: { reward: 1n, priceNum: 0n, priceDen: 0n, target: 0n, deadline: 0n } })])}
                  council={council}
                />
              ))}
            </div>
          </section>

          <section className="card">
            <div className="card-head">
              <h2>Council inbox</h2>
              <span className="muted">2-of-3 Squads vault · one member proposes, a second approves, anyone of them executes</span>
            </div>
            {pending.length === 0 && <p className="muted">No open proposals. Act as a council member and use a bounty's council actions.</p>}
            {pending.map((p) => (
              <div key={p.id} className="proposal">
                <div>
                  <b>{p.label}</b> <span className="mono">tx #{String(p.action.index)}</span>
                  <div className="muted">
                    {p.status ?? 'Active'} · approved by {p.approved.map(nameOf).join(', ') || 'nobody'} ({p.approved.length}/2)
                  </div>
                </div>
                <div className="actions">
                  <button disabled={busy || p.status === 'Executed'} onClick={() => send(`council · approve ${p.label}`, async () => [p.action.approve(actor)])}>Approve as {actorName}</button>
                  <button className="primary" disabled={busy || p.status === 'Executed'} onClick={async () => {
                    const e = await send(`council · execute ${p.label}`, async () => [p.action.execute(actor)]);
                    if (e && !e.error) setPending((list) => list.filter((x) => x.id !== p.id));
                  }}>Execute</button>
                </div>
              </div>
            ))}
          </section>

          <section className="card tools">
            <div>
              <h3>Issuer</h3>
              {MEMBERS.map((m) => (
                <div key={m} className="row">
                  <span>{PERSONAS.find((p) => p.role === m)!.label}</span>
                  <button disabled={busy} onClick={() => send(`attest ${m}`, async () => [await attestInstruction(keys.issuer, keys.issuer, a.credential, a.schema, keys[m].address, await sha256(`kyc:${m}`), 0n)], keys.issuer)}>Attest</button>
                  <button disabled={busy} onClick={() => send(`revoke and freeze ${m}`, () => revokeAndFreezeInstructions(asset, keys.issuer, keys.issuer, keys[m].address), keys.issuer)}>Revoke + freeze</button>
                </div>
              ))}
            </div>
            <div>
              <h3>Operator</h3>
              <AmountAction label="Record rent (USDC)" busy={busy} onRun={(amount) => send(`record inflow ${amount} USDC`, async () => [await recordInflowInstruction(asset, keys.operator, units(amount))], keys.operator)} />
            </div>
          </section>
        </main>

        <aside className="col timeline">
          <h2>Activity</h2>
          {log.length === 0 && <p className="muted">Every transaction you send lands here: its instructions, signature, what changed, and the exact error when it fails.</p>}
          {log.map((e) => <Entry key={e.id} e={e} nameOf={nameOf} />)}
        </aside>
      </div>

      {toast && (
        <div className={`toast ${toast.error ? 'bad' : 'good'}`} onAnimationEnd={() => setToast(undefined)}>
          {toast.error ? `✗ ${toast.label}: ${toast.error.name}` : `✓ ${toast.label}`}
        </div>
      )}
    </div>
  );
}

function Badge({ tone, children }: { tone?: string; children: React.ReactNode }) {
  return <span className={`badge ${tone ?? ''}`}>{children}</span>;
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="stat">
      <small>{label}</small>
      <b>{value}</b>
      {hint && <span className="muted">{hint}</span>}
    </div>
  );
}

function Fact({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="fact">
      <small>{label}</small>
      <span className={tone ? `tone-${tone}` : ''}>{value}</span>
    </div>
  );
}

function AmountAction({ label, options, busy, onRun }: { label: string; options?: string[]; busy: boolean; onRun: (amount: string, option?: string) => void }) {
  const [amount, setAmount] = useState('100');
  const [option, setOption] = useState(options?.[0]);
  return (
    <span className="inline">
      <input value={amount} onChange={(e) => setAmount(e.target.value)} size={7} />
      {options && (
        <select value={option} onChange={(e) => setOption(e.target.value)}>
          {options.map((o) => <option key={o}>{o}</option>)}
        </select>
      )}
      <button disabled={busy} onClick={() => onRun(amount, option)}>{label}{options ? '' : ''}</button>
    </span>
  );
}

function ProposeForm({ busy, onPropose }: { busy: boolean; onPropose: (kind: BountyKind, title: string, spec: string) => void }) {
  const [kind, setKind] = useState(BountyKind.Work);
  const [title, setTitle] = useState('Solar canopy on the rooftop');
  return (
    <span className="inline">
      <select value={kind} onChange={(e) => setKind(Number(e.target.value))}>
        <option value={BountyKind.Work}>work</option>
        <option value={BountyKind.Financial}>financial</option>
      </select>
      <input value={title} onChange={(e) => setTitle(e.target.value)} size={26} />
      <button disabled={busy} onClick={() => onPropose(kind, title, `${title} · ${Date.now()}`)}>Propose a gap</button>
    </span>
  );
}

function BountyCard(props: {
  b: Bounty;
  busy: boolean;
  actor: TransactionSigner;
  nameOf: (a: Address) => string;
  onFund: (amount: string) => void;
  onClaim: () => void;
  onDeliver: (text: string) => void;
  onSettle: () => void;
  onCouncil: (label: string, ix: () => Promise<Instruction>) => void;
  onSingleKey: () => void;
  council: (bounty: Address) => { council: TransactionSigner; asset: Address; bounty: Address };
}) {
  const { b, busy } = props;
  const [amount, setAmount] = useState(b.kind === BountyKind.Work ? '2500' : '1000');
  const state = BountyState[b.state];
  const financial = b.kind === BountyKind.Financial;
  const pct = financial && b.terms.target > 0n ? Number((b.raised * 1000n) / b.terms.target) / 10 : 0;
  const c = props.council(b.address);
  const terms = financial
    ? { reward: 0n, priceNum: 1n, priceDen: 1n, target: units(amount), deadline: 0n }
    : { reward: units(amount), priceNum: 0n, priceDen: 0n, target: 0n, deadline: 0n };
  return (
    <div className="bounty">
      <div className="bounty-head">
        <span className="kind">{financial ? '💵' : '🛠'} #{String(b.id)}</span>
        <Badge tone={STATE_TONE[state]}>{state}</Badge>
      </div>
      <b className="title">{b.title}</b>
      {financial ? (
        <>
          <div className="bar"><span style={{ width: `${Math.min(pct, 100)}%` }} /></div>
          <small className="muted">{fmt(b.raised)} / {fmt(b.terms.target)} USDC · {b.terms.priceNum.toString()}:{b.terms.priceDen.toString()} tokens per USDC{b.terms.deadline ? ` · until ${new Date(Number(b.terms.deadline) * 1000).toISOString().slice(0, 10)}` : ''}</small>
        </>
      ) : (
        <small className="muted">
          reward {b.terms.reward ? `${fmt(b.terms.reward)} FHO + FHP` : 'not curated yet'}
          {b.claimant !== '11111111111111111111111111111111' ? ` · claimed by ${props.nameOf(b.claimant)}` : ''}
        </small>
      )}
      <div className="actions">
        {financial && state === 'Open' && <><input value={amount} onChange={(e) => setAmount(e.target.value)} size={7} /><button className="primary" disabled={busy} onClick={() => props.onFund(amount)}>Fund (USDC)</button></>}
        {!financial && state === 'Open' && <button className="primary" disabled={busy} onClick={props.onClaim}>Claim</button>}
        {state === 'Claimed' && <button className="primary" disabled={busy} onClick={() => props.onDeliver(`delivery for ${b.title} · ${Date.now()}`)}>Submit delivery</button>}
        {state === 'Accepted' && <button className="primary" disabled={busy} onClick={props.onSettle}>Settle (anyone)</button>}
      </div>
      <div className="actions council-actions">
        {state === 'Proposed' && <><input value={amount} onChange={(e) => setAmount(e.target.value)} size={7} title={financial ? 'target, USDC' : 'reward, tokens'} /><button disabled={busy} onClick={() => props.onCouncil('curate', () => getCurateBountyInstructionAsync({ ...c, terms }))}>Curate</button></>}
        {state === 'Curated' && <button disabled={busy} onClick={() => props.onCouncil('open', () => getOpenBountyInstructionAsync(c))}>Open</button>}
        {state === 'Open' && financial && <button disabled={busy} onClick={() => props.onCouncil('pause', () => getPauseBountyInstructionAsync(c))}>Pause</button>}
        {state === 'Paused' && <button disabled={busy} onClick={() => props.onCouncil('resume', () => getResumeBountyInstructionAsync(c))}>Resume</button>}
        {financial && (state === 'Open' || state === 'Paused') && <button disabled={busy} onClick={() => props.onCouncil('close funding', () => getCloseFundingInstructionAsync(c))}>Close</button>}
        {state === 'Delivered' && <><button disabled={busy} onClick={() => props.onCouncil('accept', () => getAcceptDeliveryInstructionAsync(c))}>Accept</button><button disabled={busy} onClick={() => props.onCouncil('reject', () => getRejectDeliveryInstructionAsync(c))}>Reject</button></>}
        {['Proposed', 'Curated', 'Open', 'Claimed'].includes(state) && <button disabled={busy} onClick={() => props.onCouncil('cancel', () => getCancelBountyInstructionAsync(c))}>Cancel</button>}
        {state === 'Proposed' && <button className="ghost" disabled={busy} onClick={props.onSingleKey} title="Signs with the acting persona instead of the vault">one key?</button>}
        <span className="via">council · via Squads</span>
      </div>
    </div>
  );
}

function Entry({ e, nameOf }: { e: LogEntry; nameOf: (a: Address) => string }) {
  const [raw, setRaw] = useState(false);
  return (
    <div className={`entry ${e.error ? 'bad' : 'good'}`}>
      <div className="entry-head">
        <span className="icon">{e.error ? '✗' : '✓'}</span>
        <b>{e.label}</b>
      </div>
      <div className="muted">
        {nameOf(e.signer)} · {e.at.toLocaleTimeString()}
        {e.signature && <> · <a href={e.explorer} target="_blank" rel="noreferrer">{short(e.signature)}</a></>}
      </div>
      <div className="ixs">{e.instructions.map((ix, i) => <span key={i} className="chip">{ix.program}{ix.name ? ` · ${ix.name}` : ''}</span>)}</div>
      {e.error && (
        <div className="error">
          <b>{e.error.code !== undefined ? `Error ${e.error.code}` : 'Error'}</b> {e.error.name}
          <details><summary>message</summary><pre>{e.error.message}</pre></details>
        </div>
      )}
      {e.changes.length > 0 && (
        <ul className="changes">
          {e.changes.slice(0, 12).map((c) => (
            <li key={c.path}><span className="mono">{c.path}</span> <s>{String(c.from ?? '∅')}</s> → <b>{String(c.to ?? '∅')}</b></li>
          ))}
          {e.changes.length > 12 && <li className="muted">…{e.changes.length - 12} more</li>}
        </ul>
      )}
      {!e.error && e.changes.length === 0 && <div className="muted">no state change observed</div>}
      <button className="ghost" onClick={() => setRaw(!raw)}>{raw ? 'hide' : 'accounts'}</button>
      {raw && <pre>{JSON.stringify(json(e.instructions), null, 2)}</pre>}
    </div>
  );
}
