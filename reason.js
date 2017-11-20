const fs = require('fs');
const {SemanticOstrich} = require('./lib/SemanticOstrich');

const RDF = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#';
const a = RDF + 'type';
const RDFS = 'http://www.w3.org/2000/01/rdf-schema#';

const RULES = [
  {
    name: 'rdfs:subClassOf',
    from: [
      { subject: '?c', predicate: RDFS + 'subClassOf', object: '?d' },
      { subject: '?x', predicate: a,                   object: '?c' }
    ],
    to: [
      { subject: '?x', predicate: a, object: '?d' }
    ]
  }
];

if (!fs.existsSync('./data')) {
  fs.mkdirSync('./data');
}
if (!fs.existsSync('./data/test-reason.ostrich')) {
  fs.mkdirSync('./data/test-reason.ostrich');
}

async function run() {
  const store = new SemanticOstrich('./data/test-reason.ostrich');
  await store.init();

  await ingestDummyData(store);

  console.log("S-VM:");
  console.log((await store.semanticSearchTriplesVersionMaterialized(RULES, 'bobby', null, null, { version: 1 })).map(tripleToString));
  console.log("S-DM:");
  console.log((await store.semanticSearchTriplesDeltaMaterialized(RULES, 'bobby', null, null, { versionStart: 0, versionEnd: 2 })).map(tripleToString));
  console.log("S-VQ:");
  console.log((await store.semanticSearchTriplesVersion(RULES, 'bobby', null, null)).map(tripleToString));

  await store.close();
}
run().catch(console.error);

async function ingestDummyData(store) {
  if (store._store.maxVersion !== -1) {
    return;
  }

  console.log('Initializing dummy data...');
  let count = 0;

  count += await store._store.append(0, [
    { subject: 'bobby', predicate: a, object: 'Cat', addition: true },
    { subject: 'bobby', predicate: RDF + 'label', object: '"Bobby"', addition: true }
  ]);
  count += await store._store.append(1, [
    { subject: 'Cat', predicate: RDFS + 'subClassOf', object: 'Animal', addition: true },
    { subject: 'Animal', predicate: RDFS + 'subClassOf', object: 'Thing', addition: true }
  ]);
  count += await store._store.append(2, [
    // We make the type of 'bobby' more specific, so this won't result in a semantic deletion!
    { subject: 'bobby', predicate: a, object: 'Cat', addition: false },
    { subject: 'bobby', predicate: a, object: 'Tiger', addition: true },
    { subject: 'Tiger', predicate: RDFS + 'subClassOf', object: 'Cat', addition: true },
  ]);

  console.log('Done, ingested ' + count + ' triples!');
}

function tripleToString(triple) {
  let line = triple.subject + ' ' + triple.predicate + ' ' + triple.object + '.';
  if (triple.addition === true || triple.addition === false) {
    line = (triple.addition ? '+' : '-') + ' ' + line;
  }
  if (triple.versions) {
    line += ' @' + triple.versions;
  }
  return line;
}
