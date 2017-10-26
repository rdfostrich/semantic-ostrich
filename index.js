const ostrich = require('ostrich-bindings');
const fs = require('fs');
const _ = require('lodash');
const {promisify} = require('util');

const FOAF = 'http://xmlns.com/foaf/0.1/';
const OWL = 'http://www.w3.org/2002/07/owl#';
const SAMEAS = OWL + 'sameAs';

if (!fs.existsSync('./data')) {
  fs.mkdirSync('./data');
}
if (!fs.existsSync('./data/test.ostrich')) {
  fs.mkdirSync('./data/test.ostrich');
}

ostrich.fromPath('./data/test.ostrich', false, async (error, store) => {
  promisifyStore(store);

  if (store.maxVersion === -1) {
    await ingestDummyData(store);
  }

  await queryDummy(store);

  store.close();
});

function promisifyStore(store) {
  store.append = promisify(store.append);
  store.searchTriplesVersionMaterialized = promisify(store.searchTriplesVersionMaterialized);
}

async function ingestDummyData(store) {
  console.log('Initializing dummy data...');
  let count = 0;

  count += await store.append(0, [
    { subject: 'http://www.rubensworks.net/#me', predicate: FOAF + 'name', object: '"Ruben Taelman"', addition: true }
  ]);
  count += await store.append(1, [
    { subject: 'https://www.rubensworks.net/#me', predicate: FOAF + 'fullName', object: '"Ruben Taelman"', addition: true },
    { subject: 'http://www.rubensworks.net/#me', predicate: FOAF + 'name', object: '"Ruben Taelman"', addition: false },
    { subject: 'http://www.rubensworks.net/#me', predicate: SAMEAS, object: 'https://www.rubensworks.net/#me', addition: true },
    { subject: FOAF + 'name', predicate: SAMEAS, object: FOAF + 'fullName', addition: true },
  ]);

  console.log('Done, ingested ' + count + ' triples!');
}

async function queryDummy(store) {
  console.log('Querying dummy data...');

  let triples = await semanticSearchTriplesVersionMaterialized(store,
    'http://www.rubensworks.net/#me', FOAF + 'name', null, { version: 1 }, false);
  console.log(triples); // TODO

  console.log('Done querying!');
}

async function semanticSearchTriplesVersionMaterialized(store, s, p, o, options, allResultCombinations) {
  // Find same URIs for S, P and O
  let ss = await querySame(store, s, options.version);
  let ps = await querySame(store, p, options.version);
  let os = await querySame(store, o, options.version);

  // Make all query combinations
  let combinations = [];
  for (const cs of ss) {
    for (const cp of ps) {
      for (const co of os) {
        combinations.push({ subject: cs, predicate: cp, object: co });
      }
    }
  }

  // Start all queries
  let results = [].concat.apply([], await Promise.all(combinations.map((c) =>
    store.searchTriplesVersionMaterialized(c.subject, c.predicate, c.object, options))));

  if (allResultCombinations) {
    // Add additional results for same URIs
    results = results.concat(getSameResults(results, ss, 'subject'));
    results = results.concat(getSameResults(results, ps, 'predicate'));
    results = results.concat(getSameResults(results, os, 'object'));
  } else {
    // Ensure that our results exactly match the original pattern
    results.forEach((result) => {
      if (s) result.subject   = s;
      if (p) result.predicate = p;
      if (o) result.object    = o;
    });
  }

  return _.uniqWith(results, _.isEqual);

  function getSameResults(results, uris, field) {
    const additional = [];
    for (const result of results) {
      for (const uri of uris) {
        if (uri === result[field]) {
          for (const urii of uris) {
            if (urii !== uri) {
              const triple = _.clone(result);
              triple[field] = urii;
              additional.push(triple);
            }
          }
        }
      }
    }
    return additional;
  }
}

async function querySame(store, uri, version) {
  if (!uri) {
    return [uri];
  }
  let o = _.map(await store.searchTriplesVersionMaterialized(uri, SAMEAS, null, { version: version }), 'object');
  let s = _.map(await store.searchTriplesVersionMaterialized(null, SAMEAS, uri, { version: version }), 'subject');
  return _.uniqWith(o.concat(s).concat([uri]), _.isEqual);
}
