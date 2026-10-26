# 04 · Work and the council

**You leave with:** a work bounty taken from gap to settlement, accepted by two of three council
members. **Time:** ~15 min.

## How it works

A **work bounty** goes `Proposed → Curated → Open → Claimed → Delivered → Accepted → Settled`
(or `Rejected`). The council is a Squads 2-of-3 vault: its address signs Cachain's council
instructions only after two members approve inside Squads. `settle_work` mints exactly the reward
written at curation, to the member who claimed it, and is permissionless because nothing about it
is left to choose.

<p align="center"><img src="../../assets/state-machine.svg" alt="Bounty state machine" width="100%"></p>

## In the harness

1. As **Bruno**, on the rooftop bounty, press **Claim**, then **Submit delivery**.
2. As **Council A**, press **Accept** (council row). It appears in the **Council inbox** with 1/2 approvals.
3. As **Council B**, press **Approve as Council B**, then **Execute**. The bounty turns *Accepted*.
4. Press **Settle (anyone)**. Bruno's FHO and FHP rise by the reward; the holding's by a quarter of it.
5. Try the shortcut: on a *Proposed* bounty, press **one key?** → `✗ NotCouncil` (6000).

## In code

```ts
const action = await councilAction(rpc, multisig, [
  await getAcceptDeliveryInstructionAsync({ council: createNoopSigner(vault), asset, bounty }),
], memberA);
await send(action.propose);            // member A proposes and approves
await send([action.approve(memberB)]); // member B approves
await send([action.execute(memberA)]); // any member executes
```

## ✅ Proof

`tests/work.test.ts` and `tests/council.test.ts`: no mint before acceptance; a rejected delivery
mints nothing; terms cannot change after curation; one key cannot curate or accept; Squads refuses
to execute with one approval; an outsider cannot approve; a claimed but undelivered bounty can be
cancelled by the council.

---
[← 03 · Fund a tranche](03-fund-a-tranche.md) · [05 · Rent and claims →](05-rent-and-claims.md)
