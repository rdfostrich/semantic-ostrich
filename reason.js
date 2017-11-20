const ostrich = require('ostrich-bindings');
const fs = require('fs');
const _ = require('lodash');
const {promisify} = require('util');

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

ostrich.fromPath('./data/test-reason.ostrich', false, async (error, store) => {
  promisifyStore(store);

  if (store.maxVersion === -1) {
    await ingestDummyData(store);
  }

  //console.log((await queryDummyVm(RULES, store)).map(tripleToString));

  console.log((await queryDummyVq(RULES, store)).map(tripleToString));

  store.close();
});

function promisifyStore(store) {
  store.append = promisify(store.append);
  store.searchTriplesVersionMaterialized = promisify(store.searchTriplesVersionMaterialized);
  store.searchTriplesDeltaMaterialized = promisify(store.searchTriplesDeltaMaterialized);
  store.searchTriplesVersion = promisify(store.searchTriplesVersion);

  store.countTriplesVersionMaterialized = promisify(store.countTriplesVersionMaterialized);
}

async function ingestDummyData(store) {
  console.log('Initializing dummy data...');
  let count = 0;

  count += await store.append(0, [
    { subject: 'bobby', predicate: a, object: 'Cat', addition: true },
    { subject: 'bobby', predicate: RDF + 'label', object: '"Bobby"', addition: true }
  ]);
  count += await store.append(1, [
    { subject: 'Cat', predicate: RDFS + 'subClassOf', object: 'Animal', addition: true },
    { subject: 'Animal', predicate: RDFS + 'subClassOf', object: 'Thing', addition: true }
  ]);

  console.log('Done, ingested ' + count + ' triples!');
}

function tripleToString(triple) {
  var line = triple.subject + ' ' + triple.predicate + ' ' + triple.object + '.';
  if (triple.addition === true || triple.addition === false) {
    line = (triple.addition ? '+' : '-') + ' ' + line;
  }
  if (triple.versions) {
    line += ' @' + triple.versions;
  }
  return line;
}

async function queryDummyVm(rules, store) {
  return await semanticSearchTriplesVersionMaterialized(rules, store, 'bobby', null, null, { version: 1 });
}

async function queryDummyVq(rules, store) {
  return await semanticSearchTriplesVersion(rules, store, 'bobby', null, null);
}

async function semanticSearchTriplesVersionMaterialized(rules, store, s, p, o, options) {
  const pattern = { subject: s || '?s', predicate: p || '?p', object: o || '?o' };
  // Collect all applicable rules to the pattern, and instantiate them for the pattern
  const appliedRules = getApplicableRules(rules, pattern);

  // Get results from original pattern
  let triples = await store.searchTriplesVersionMaterialized(s, p, o, options);

  // Infer triples from rules
  let reasonTriples = triples;
  while (reasonTriples.length > 0) {
    const inferredTriples = await inferTriples(reasonTriples, appliedRules,
      async (s, p, o) => await store.searchTriplesVersionMaterialized(s, p, o, options));
    reasonTriples = inferredTriples;
    triples = triples.concat(inferredTriples)
  }

  return triples;
}

async function semanticSearchTriplesVersion(rules, store, s, p, o, options) {
  const pattern = { subject: s || '?s', predicate: p || '?p', object: o || '?o' };
  // Collect all applicable rules to the pattern, and instantiate them for the pattern
  const appliedRules = getApplicableRules(rules, pattern);

  // Get results from original pattern
  let triples = await store.searchTriplesVersion(s, p, o, options);

  // Infer triples from rules
  let reasonTriples = triples;
  while (reasonTriples.length > 0) {
    const inferredTriples = await inferTriples(reasonTriples, appliedRules,
      async (s, p, o) => await store.searchTriplesVersion(s, p, o, options));
    reasonTriples = inferredTriples;
    triples = triples.concat(inferredTriples)
  }

  return triples;
}

function getApplicableRules(rules, pattern) {
  return rules.reduce((acc, rule) => {
    var bindings = [];
    for (const rulePattern of rule.to) {
      var binding;
      if (!(binding = matchPatterns(rulePattern, pattern))) {
        return acc;
      }
      bindings.push(binding);
    }

    let mergedBindings;
    if (bindings.length > 0 && (mergedBindings = bindingsCompatible(bindings))) {
      acc.push(bindRule(rule, mergedBindings));
    }

    return acc;
  }, []);
}

async function inferTriples(triples, appliedRules, queryer) {
  // Get and materialize rules that can be used to infer new triples
  var inferableRules = [];
  triples.forEach((triple) => {
    for (const rule of appliedRules) {
      var bindings = [];
      for (const rulePattern of rule.from) {
        var binding;
        if (binding = matchPatterns(rulePattern, triple)) {
          bindings.push(binding);
        }
      }

      var mergedBindings;
      if (bindings.length > 0 && (mergedBindings = bindingsCompatible(bindings))) {
        inferableRules.push(bindRule(rule, mergedBindings));
      }
    }
  });

  // Filter rule conditions that have been fulfilled.
  inferableRules = inferableRules.map((rule) => {
    rule = _.cloneDeep(rule);
    for (let i = rule.from.length - 1; i >= 0; i--) {
      if (isPatternMaterialized(rule.from[i])) {
        rule.from.splice(i);
      }
    }
    return rule;
  });

  // Infer triples from rules
  return _.concat.apply(_, await Promise.all(inferableRules.map(async (rule) => {
    const bindings = await evaluateBgp(rule.from, queryer);
    return _.concat.apply(_, bindings.map((binding) => {
      const boundRule = bindRule(rule, binding);
      return boundRule.to;
    }));
  })));
}

async function evaluateBgp(patterns, queryer) {
  if (patterns.length === 0) {
    return [];
  } else if (patterns.length === 1) {
    return getPatternBindings(patterns[0], queryer);
  } else {
    throw new Error('BGPs with multiple patterns are not supported yet!');
    /*var counts = await Promise.all(patterns.map((pattern) =>
      store.countTriplesVersionMaterialized(pattern.subject, pattern.predicate, pattern.object, version)));*/
  }
}

async function getPatternBindings(pattern, queryer) {
  let triples = await queryer(pattern.subject, pattern.predicate, pattern.object);
  return triples.map((triple) => {
    const binding = {};
    if (isVariable(pattern.subject)) binding[pattern.subject] = triple.subject;
    if (isVariable(pattern.predicate)) binding[pattern.predicate] = triple.predicate;
    if (isVariable(pattern.object)) binding[pattern.object] = triple.object;
    if ('versions' in triple) binding.versions = triple.versions;
    return binding;
  });
}

function isPatternMaterialized(pattern) {
  return !isVariable(pattern.subject)
    && !isVariable(pattern.predicate)
    && !isVariable(pattern.object);
}

function bindingsCompatible(bindings) {
  const acc = {};
  for (const binding of bindings) {
    for (const key in binding) {
      const existing = acc[key];
      if (existing && existing !== binding[key]) {
        return false;
      }
      if (!existing) {
        acc[key] = binding[key];
      }
    }
  }
  return acc;
}

function bindRule(rule, bindings) {
  rule = _.cloneDeep(rule);
  const patternApplyer = (pattern) => bindPattern(pattern, bindings);
  rule.from = rule.from.map(patternApplyer);
  rule.to = rule.to.map(patternApplyer);
  return rule;
}

function bindPattern(pattern, bindings) {
  const triple = {
    subject: bindings[pattern.subject] || pattern.subject,
    predicate: bindings[pattern.predicate] || pattern.predicate,
    object: bindings[pattern.object] || pattern.object,
  };
  if ('versions' in bindings) triple.versions = bindings.versions;
  return triple;
}

function matchPatterns(p1, p2) {
  var s = termMatch(p1.subject, p2.subject);
  if (!s) return false;
  var p = termMatch(p1.predicate, p2.predicate);
  if (!p) return false;
  var o = termMatch(p1.object, p2.object);
  if (!o) return false;
  return _.defaults.apply(_, [s, p, o]);
}

function termMatch(t1, t2) {
  if (isVariable(t1)) {
    const binding = {};
    if (!isVariable(t2)) {
      binding[t1] = t2;
    }
    return binding;
  }
  if (isVariable(t2) || t1 === t2) {
    return {};
  }
  return false;
}

function isVariable(t) {
  return t.charAt(0) === '?' || t.charAt(0) === '_';
}
