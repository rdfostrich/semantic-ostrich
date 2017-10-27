const ostrich = require('ostrich-bindings');
const fs = require('fs');
const _ = require('lodash');
const {promisify} = require('util');

const FOAF = 'http://xmlns.com/foaf/0.1/';
const OWL = 'http://www.w3.org/2002/07/owl#';
const EX = 'http://example.org/';
const SAMEAS = OWL + 'sameAs';
const BECOMES = EX + 'becomes'; // Like sameAs, but with temporal semantics

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

  //await queryDummyVm(store);
  await queryDummyDm(store);
  //await queryDummyVq(store);

  store.close();
});

function promisifyStore(store) {
  store.append = promisify(store.append);
  store.searchTriplesVersionMaterialized = promisify(store.searchTriplesVersionMaterialized);
  store.searchTriplesDeltaMaterialized = promisify(store.searchTriplesDeltaMaterialized);
  store.searchTriplesVersion = promisify(store.searchTriplesVersion);
}

async function ingestDummyData(store) {
  console.log('Initializing dummy data...');
  let count = 0;

  count += await store.append(0, [
    { subject: 'http://www.rubensworks.net/#me', predicate: FOAF + 'name', object: '"Ruben Taelman"', addition: true }
  ]);
  count += await store.append(1, [
    //{ subject: 'https://www.rubensworks.net/#me', predicate: FOAF + 'fullName', object: '"Ruben Taelman"', addition: true },
    //{ subject: 'http://www.rubensworks.net/#me', predicate: FOAF + 'name', object: '"Ruben Taelman"', addition: false },

    //{ subject: 'http://www.rubensworks.net/#me', predicate: SAMEAS, object: 'https://www.rubensworks.net/#me', addition: true },
    //{ subject: FOAF + 'name', predicate: SAMEAS, object: FOAF + 'fullName', addition: true },

    { subject: 'https://www.rubensworks.net/#me', predicate: FOAF + 'name', object: '"Ruben Taelman"', addition: true },
    { subject: 'http://www.rubensworks.net/#me', predicate: FOAF + 'name', object: '"Ruben Taelman"', addition: false },

    { subject: 'http://www.rubensworks.net/#me', predicate: BECOMES, object: 'https://www.rubensworks.net/#me', addition: true },
    { subject: FOAF + 'name', predicate: BECOMES, object: FOAF + 'fullName', addition: true },
  ]);

  console.log('Done, ingested ' + count + ' triples!');
}

async function queryDummyVm(store) {
  console.log('Querying dummy data VM...');

  let triples = await semanticSearchTriplesVersionMaterialized(store, 'http://www.rubensworks.net/#me', null, null, { version: 1 }, false);
  console.log(triples);

  console.log('Done querying!');
}

async function queryDummyDm(store) {
  console.log('Querying dummy data DM...');

  let triples = await semanticSearchTriplesDeltaMaterialized(store, 'http://www.rubensworks.net/#me', null, null, { versionStart: 0, versionEnd: 1 });
  console.log(triples);

  console.log('Done querying!');
}

async function queryDummyVq(store) {
  console.log('Querying dummy data VQ...');

  let triples = await semanticSearchTriplesDeltaMaterialized(store, 'http://www.rubensworks.net/#me', null, null, {}, false);
  console.log(triples);

  console.log('Done querying!');
}

/**
 * S-VM
 * Regular VM, but sameAs links for this version are taken into account to produce additional triples.
 */
async function semanticSearchTriplesVersionMaterialized(store, s, p, o, options, allResultCombinations) {
  let combinationsData = await getQueryCombinations(store, s, p, o, options.version);
  let { combinations, ss, ps, os } = combinationsData;

  // Start all queries
  let results = [].concat.apply([], await Promise.all(combinations.map((c) =>
    store.searchTriplesVersionMaterialized(c.subject, c.predicate, c.object, options))));

  return await getQueryResultsCombinations(results, ss, ps, os, s, p, o, allResultCombinations);
}

/**
 * S-DM
 * Regular DM, but sameAs links for this version are taken into account to produce less triples.
 */
async function semanticSearchTriplesDeltaMaterialized(store, s, p, o, options) {
  let combinations = (await getQueryCombinations(store, s, p, o)).combinations;

  // Start all queries
  let results = [].concat.apply([], await Promise.all(combinations.map((c) =>
    store.searchTriplesDeltaMaterialized(c.subject, c.predicate, c.object, options))));

  // Make a convenience mapping from all URI to all its same URIs
  let sameUris = results.reduce((acc, result) => {
    if (result.predicate === SAMEAS || result.predicate === BECOMES) {
      if (!acc[result.subject]) acc[result.subject] = [];
      if (!acc[result.object])  acc[result.object]  = [];
      acc[result.subject].push(result.object);
      acc[result.object] .push(result.subject);
    }
    return acc;
  }, {});

  // Remove addition/deletion tuples that can be implied by the collected sameUris.
  let filterResults = [];
  for (let result1 of results) {
    let removeS = sameUris[result1.subject]   || [];
    let removeP = sameUris[result1.predicate] || [];
    let removeO = sameUris[result1.object]    || [];
    if (removeS.length || removeP.length || removeO.length) {
      for (let i = 0; i < results.length; i++) {
        let result2 = results[i];
        if ((removeS.indexOf(result2.subject)  >= 0 || result2.subject   === result1.subject)
        || (removeP.indexOf(result2.predicate) >= 0 || result2.predicate === result1.predicate)
        || (removeO.indexOf(result2.object)    >= 0 || result2.object    === result1.object)) {
          filterResults.push(i);
        }
      }
    }
  }
  return results.filter((result, i) => filterResults.indexOf(i) < 0);
}

/**
 * S-VQ
 * Regular VQ, but sameAs links for this version are taken into account to produce additional triples.
 */
async function semanticSearchTriplesVersion(store, s, p, o, options, allResultCombinations) {
  let combinationsData = await getQueryCombinations(store, s, p, o);
  let { combinations, ss, ps, os } = combinationsData;

  // Start all queries
  let results = [].concat.apply([], await Promise.all(combinations.map((c) =>
    store.searchTriplesVersion(c.subject, c.predicate, c.object, options))));

  // Get all combinations, and merge potential duplicate triples by version.
  return _.values((await getQueryResultsCombinations(results, ss, ps, os, s, p, o, allResultCombinations)).reduce(
    (acc, triple) => {
      let hash = JSON.stringify(_.omit(triple, 'versions'));
      if (!acc[hash]) {
        acc[hash] = { triple: triple, versions: [] };
      }
      acc[hash].versions = _.uniq(acc[hash].versions.concat(triple.versions));
      return acc;
    }, {})).map((value) => { return _.merge(value.triple, _.omit(value, 'triple')); });
}

/**
 * Retrieve all possible query combinations for the given query pattern.
 * This will be done based on all samAs links in the store.
 * The version param is optional.
 */
async function getQueryCombinations(store, s, p, o, version) {
  // Find same URIs for S, P and O
  let ss = await querySame(store, s, version);
  let ps = await querySame(store, p, version);
  let os = await querySame(store, o, version);

  // Make all query combinations
  let combinations = [];
  for (const cs of ss) {
    for (const cp of ps) {
      for (const co of os) {
        combinations.push({ subject: cs, predicate: cp, object: co });
      }
    }
  }

  return {
    combinations: combinations,
    ss: ss,
    ps: ps,
    os: os
  };
}

/**
 * If allResultCombinations is true, all combinations of results based on the given sameAs arrays will be calculated.
 * If allResultCombinations is false, all results will be canonicalized to the given query pattern.
 */
async function getQueryResultsCombinations(results, ss, ps, os, s, p, o, allResultCombinations) {
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

/**
 * Retrieve an array of all the "same" URIs from the given URI.
 * @param store The store.
 * @param uri The URI
 * @param version An optional version scope. If not given, all versions are taken into account.
 * @return {Promise.<*>} An array of URIs.
 */
async function querySame(store, uri, version) {
  if (!uri) {
    return [uri];
  }
  let o1, s1, o2, s2;
  if (version || version === 0) {
    o1 = _.map(await store.searchTriplesVersionMaterialized(uri, SAMEAS, null, {version: version}), 'object');
    s1 = _.map(await store.searchTriplesVersionMaterialized(null, SAMEAS, uri, {version: version}), 'subject');
    o2 = _.map(await store.searchTriplesVersionMaterialized(uri, BECOMES, null, {version: version}), 'object');
    s2 = _.map(await store.searchTriplesVersionMaterialized(null, BECOMES, uri, {version: version}), 'subject');
  } else {
    o1 = _.map(await store.searchTriplesVersion(uri, SAMEAS, null), 'object');
    s1 = _.map(await store.searchTriplesVersion(null, SAMEAS, uri), 'subject');
    o2 = _.map(await store.searchTriplesVersion(uri, BECOMES, null), 'object');
    s2 = _.map(await store.searchTriplesVersion(null, BECOMES, uri), 'subject');
  }
  return _.uniqWith(o1.concat(s1).concat(o2).concat(s2).concat([uri]), _.isEqual);
}

