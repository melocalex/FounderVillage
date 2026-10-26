// Generates the Kit clients from IDLs. Run after `anchor build`; CI fails if the output drifts.
//   founder-village: target/idl/founder_village.json (written by `anchor build`)
//   squads:  idl/squads_multisig_program.json (Squads v4 SDK, MIT, vendored)
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { rootNodeFromAnchor, type AnchorIdl } from '@codama/nodes-from-anchor';
import { renderVisitor } from '@codama/renderers-js';
import {
  addPdasVisitor,
  constantPdaSeedNodeFromString,
  createFromRoot,
  pdaValueNode,
  programIdValueNode,
  setInstructionAccountDefaultValuesVisitor,
} from 'codama';

const render = (idlPath: string, name: string) => {
  const idl = JSON.parse(readFileSync(idlPath, 'utf8')) as AnchorIdl;
  const codama = createFromRoot(rootNodeFromAnchor(idl));
  if (name === 'founder-village') {
    // Keep a copy of our own IDL next to the vendored one so the client can be regenerated
    // without building the program.
    mkdirSync('idl', { recursive: true });
    writeFileSync('idl/founder_village.json', JSON.stringify(idl, null, 2) + '\n');
    // Anchor's IDL does not carry the seeds of the #[event_cpi] accounts; add them so every
    // builder fills them in.
    codama.update(
      addPdasVisitor({
        founderVillage: [{ name: 'eventAuthority', seeds: [constantPdaSeedNodeFromString('utf8', '__event_authority')] }],
      }),
    );
    codama.update(
      setInstructionAccountDefaultValuesVisitor([
        { account: 'eventAuthority', defaultValue: pdaValueNode('eventAuthority') },
        { account: 'program', defaultValue: programIdValueNode() },
      ]),
    );
  }
  codama.accept(
    renderVisitor('clients/ts', {
      generatedFolder: `src/generated/${name}`,
      syncPackageJson: false,
      kitImportStrategy: 'rootOnly',
    }),
  );
};

const programIdl = process.argv.includes('--from-committed') ? 'idl/founder_village.json' : 'target/idl/founder_village.json';
render(programIdl, 'founder-village');
render('idl/squads_multisig_program.json', 'squads');
console.log('codama: clients/ts/src/generated/{founder-village,squads}');
