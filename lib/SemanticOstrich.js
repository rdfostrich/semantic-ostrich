const ostrich = require('ostrich-bindings');
const {promisify} = require('util');
const _ = require('lodash');
const fs = require('fs');
const N3Parser = require('n3-parser.js').N3Parser;

/**
 * A wrapper around OSTRICH to provide semantic querying capabilities.
 */
export class SemanticOstrich {

  constructor() {

  }

  init(pathDataset, pathLanguage, readonly) {
    return new Promise((resolve, reject) => {
      ostrich.fromPath(pathDataset, !!readonly, async (error, storeDataset) => {
        if (error) {
          return reject(error);
        }
        this._promisifyStore(storeDataset);
        this._storeDataset = storeDataset;
        if (pathLanguage) {
          ostrich.fromPath(pathLanguage, !!readonly, async (error, storeLanguage) => {
            if (error) {
              return reject(error);
            }
            this._promisifyStore(storeLanguage);
            this._storeLanguage = storeLanguage;
            resolve();
          });
        } else {
          resolve();
        }
      });
    });
  }

  close() {
    this._storeDataset.close();
    if (this._storeLanguage) {
      this._storeLanguage.close();
    }
  }

  _promisifyStore(store) {
    store.append = promisify(store.append);
    store.searchTriplesVersionMaterialized = promisify(store.searchTriplesVersionMaterialized);
    store.searchTriplesDeltaMaterialized = promisify(store.searchTriplesDeltaMaterialized);
    store.searchTriplesVersion = promisify(store.searchTriplesVersion);

    store.countTriplesVersionMaterialized = promisify(store.countTriplesVersionMaterialized);
    store.countTriplesDeltaMaterialized = promisify(store.countTriplesDeltaMaterialized);
    store.countTriplesVersion = promisify(store.countTriplesVersion);
  }

  // TODO: rm?
  async queryStores(fn, s, p, o, optionsDataset, optionsLanguage) {
    let fnDataset = fn;
    let fnLanguage = fn;
    let flagLanguageTriplesAsAdditions = false;
    // Special case if we DM -1 -> 0.
    if (optionsLanguage && optionsLanguage.versionStart === -1) {
      fnLanguage = 'searchTriplesVersionMaterialized';
      optionsLanguage = { version: 0 };
      flagLanguageTriplesAsAdditions = true;
    }

    if (!this._storeLanguage) {
      return await this._storeDataset[fn](s, p, o, optionsDataset);
    }
    const [triples1, triples2] = await Promise.all([this._storeDataset[fnDataset](s, p, o, optionsDataset), this._storeLanguage[fnLanguage](s, p, o, optionsLanguage)]);
    if (flagLanguageTriplesAsAdditions) {
      triples2.forEach((triple) => triple.addition = true);
    }
    return triples1.concat(triples2);
  }

  async semanticSearchTriplesVersionMaterialized(rules, s, p, o, optionsDataset, optionsLanguage) {
    this.lastQueryCount = 1;
    const pattern = { subject: s || '?s', predicate: p || '?p', object: o || '?o' };
    // Collect all applicable rules to the pattern, and instantiate them for the pattern
    const appliedRules = this.getApplicableRules(rules, pattern);

    // Get results from original pattern
    let triples = await this._storeDataset.searchTriplesVersionMaterialized(s, p, o, optionsDataset);

    // Infer triples from rules
    let reasonTriples = triples;
    while (reasonTriples.length > 0) {
      const inferredTriples = await this.inferTriples(reasonTriples, appliedRules,
        (s, p, o) => this.queryStores('searchTriplesVersionMaterialized', s, p, o, optionsLanguage));
      reasonTriples = inferredTriples;
      triples = triples.concat(inferredTriples)
    }

    return triples;
  }

  async semanticSearchTriplesDeltaMaterialized(rules, s, p, o, optionsDataset, optionsLanguage) {
    this.lastQueryCount = 1;
    const pattern = { subject: s || '?s', predicate: p || '?p', object: o || '?o' };
    // Collect all applicable rules to the pattern, and instantiate them for the pattern
    const appliedRules = this.getApplicableRules(rules, pattern);

    // Get results from original pattern
    let triples = await this._storeDataset.searchTriplesDeltaMaterialized(s, p, o, optionsDataset);

    // Infer triples from rules
    let reasonTriples = triples;
    while (reasonTriples.length > 0) {
      const inferredTriples = await this.inferTriples(reasonTriples, appliedRules,
        (s, p, o) => this.queryStores('searchTriplesDeltaMaterialized', s, p, o, optionsDataset, optionsLanguage));
      reasonTriples = inferredTriples;

      // Remove deletions that can still be inferred using the knowledge that is still available
      triples = triples.filter((triple) => {
        for (const inferredTriple of inferredTriples) {
          if (!triple.addition && this.matchPatterns(triple, inferredTriple)) {
            return false;
          }
        }
        return true;
      });
    }

    return triples;
  }

  async semanticSearchTriplesVersion(rules, s, p, o, optionsDataset, optionsLanguage) {
    this.lastQueryCount = 1;
    const pattern = { subject: s || '?s', predicate: p || '?p', object: o || '?o' };
    // Collect all applicable rules to the pattern, and instantiate them for the pattern
    const appliedRules = this.getApplicableRules(rules, pattern);

    // Get results from original pattern
    let triples = await this._storeDataset.searchTriplesVersion(s, p, o, optionsDataset);

    // Infer triples from rules
    let reasonTriples = triples;
    while (reasonTriples.length > 0) {
      const inferredTriples = await this.inferTriples(reasonTriples, appliedRules,
        (s, p, o) => this.queryStores('searchTriplesVersion', s, p, o, optionsDataset, optionsLanguage));
      reasonTriples = inferredTriples;
      triples = this.concatTriples(triples, inferredTriples);
    }

    return triples;
  }

  concatTriples(triples1, triples2) {
    const triplesConcat = triples1.concat([]);
    const toConcat = [];
    // This will concat triples and removes duplicates
    for (const triple2 of triples2) {
      let matched = false;
      for (const triple1 of triples1) {
        if (this.matchPatterns(triple1, triple2)) {
          matched = true;
          // If triples have version annotations, merge them.
          if (triple1.versions && triple2.versions) {
            triple1.versions = _.uniq(triple1.versions.concat(triple2.versions));
          }
          break;
        }
      }
      if (!matched) {
        toConcat.push(triple2);
      }
    }
    return triplesConcat.concat(toConcat);
  }

  getApplicableRules(rules, pattern) {
    return rules.reduce((acc, rule) => {
      const bindings = [];
      for (const rulePattern of rule.to) {
        var binding;
        if (!(binding = this.matchPatterns(rulePattern, pattern))) {
          return acc;
        }
        bindings.push(binding);
      }

      let mergedBindings;
      if (bindings.length > 0 && (mergedBindings = this.bindingsCompatible(bindings))) {
        acc.push(this.bindRule(rule, mergedBindings));
      }

      return acc;
    }, []);
  }

  async inferTriples(triples, appliedRules, queryer) {
    // Get and materialize rules that can be used to infer new triples
    let inferableRules = [];
    triples.forEach((triple) => {
      for (const rule of appliedRules) {
        const bindings = [];
        for (const rulePattern of rule.from) {
          let binding;
          if (binding = this.matchPatterns(rulePattern, triple)) {
            bindings.push(binding);
          }
        }

        let mergedBindings;
        if (bindings.length > 0 && (mergedBindings = this.bindingsCompatible(bindings))) {
          inferableRules.push(this.bindRule(rule, mergedBindings));
        }
      }
    });

    // Filter rule conditions that have been fulfilled.
    inferableRules = inferableRules.map((rule) => {
      rule = _.cloneDeep(rule);
      for (let i = rule.from.length - 1; i >= 0; i--) {
        if (this.isPatternMaterialized(rule.from[i])) {
          rule.from.splice(i);
        }
      }
      return rule;
    });

    // Infer triples from rules
    return _.concat.apply(_, await Promise.all(inferableRules.map(async (rule) => {
      const bindings = await this.evaluateBgp(rule.from, queryer);
      return _.concat.apply(_, bindings.map((binding) => {
        const boundRule = this.bindRule(rule, binding);
        return boundRule.to;
      }));
    })));
  }

  async evaluateBgp(patterns, queryer) {
    if (patterns.length === 0) {
      return [];
    } else if (patterns.length === 1) {
      return this.getPatternBindings(patterns[0], queryer);
    } else {
      throw new Error('BGPs with multiple patterns are not supported yet!');
      /*var counts = await Promise.all(patterns.map((pattern) =>
        store.countTriplesVersionMaterialized(pattern.subject, pattern.predicate, pattern.object, version)));*/
    }
  }

  async getPatternBindings(pattern, queryer) {
    let triples = await queryer(pattern.subject, pattern.predicate, pattern.object);
    this.lastQueryCount++;
    return triples.map((triple) => {
      const binding = {};
      if (this.isVariable(pattern.subject)) binding[pattern.subject] = triple.subject;
      if (this.isVariable(pattern.predicate)) binding[pattern.predicate] = triple.predicate;
      if (this.isVariable(pattern.object)) binding[pattern.object] = triple.object;
      if ('versions' in triple) binding.versions = triple.versions;
      if ('addition' in triple) binding.addition = triple.addition;
      return binding;
    });
  }

  isPatternMaterialized(pattern) {
    return !this.isVariable(pattern.subject)
      && !this.isVariable(pattern.predicate)
      && !this.isVariable(pattern.object);
  }

  bindingsCompatible(bindings) {
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

  bindRule(rule, bindings) {
    rule = _.cloneDeep(rule);
    const patternApplyer = (pattern) => this.bindPattern(pattern, bindings);
    rule.from = rule.from.map(patternApplyer);
    rule.to = rule.to.map(patternApplyer);
    return rule;
  }

  bindPattern(pattern, bindings) {
    const triple = {
      subject: bindings[pattern.subject] || pattern.subject,
      predicate: bindings[pattern.predicate] || pattern.predicate,
      object: bindings[pattern.object] || pattern.object,
    };
    if ('versions' in bindings) triple.versions = bindings.versions;
    if ('addition' in bindings) triple.addition = bindings.addition;
    return triple;
  }

  matchPatterns(p1, p2) {
    const s = this.termMatch(p1.subject, p2.subject);
    if (!s) return false;
    const p = this.termMatch(p1.predicate, p2.predicate);
    if (!p) return false;
    const o = this.termMatch(p1.object, p2.object);
    if (!o) return false;
    return _.defaults.apply(_, [s, p, o]);
  }

  termMatch(t1, t2) {
    if (this.isVariable(t1)) {
      const binding = {};
      if (!this.isVariable(t2)) {
        binding[t1] = t2;
      }
      return binding;
    }
    if (this.isVariable(t2) || t1 === t2) {
      return {};
    }
    return false;
  }

  isVariable(t) {
    return t.charAt(0) === '?' || t.charAt(0) === '_';
  }

  static tripleToString(triple) {
    let line = triple.subject + ' ' + triple.predicate + ' ' + triple.object + '.';
    if (triple.addition === true || triple.addition === false) {
      line = (triple.addition ? '+' : '-') + ' ' + line;
    }
    if (triple.versions) {
      line += ' @' + triple.versions;
    }
    return line;
  }

  static readRules(pathRules) {
    return SemanticOstrich.simplifyJsonLdRules(new N3Parser().toJSONLD(fs.readFileSync(pathRules, 'utf-8')));
  }

  static simplifyJsonLdRules(rulesJsonLd) {
    if (rulesJsonLd['http://www.w3.org/2000/10/swap/log#implies']) {
      // Only one rule is defined.
      return [ SemanticOstrich.simplifyJsonLdRule(rulesJsonLd) ];
    } else {
      return rulesJsonLd["@graph"].map(SemanticOstrich.simplifyJsonLdRule);
    }
  }

  static simplifyJsonLdRule(ruleJsonLd) {
    const fromTriples = ruleJsonLd['@graph'].map(SemanticOstrich.graphToTriples).flatten();
    const toTriples = ruleJsonLd['http://www.w3.org/2000/10/swap/log#implies']['@graph']
      .map(SemanticOstrich.graphToTriples).flatten();
    return {
      from: fromTriples,
      to: toTriples
    }
  }

  static graphToTriples(graph) {
    const triples = [];
    const subject = graph['@id'];
    for (const key of Object.keys(graph)) {
      if (key !== '@id') {
        const predicate = key === '@type' ? 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type' : key;
        const object = graph[key]['@id'] ? graph[key]['@id'] : graph[key];
        triples.push({ subject: subject, predicate: predicate, object: object });
      }
    }
    return triples;
  }

}