const ostrich = require('ostrich-bindings');
const {promisify} = require('util');
const _ = require('lodash');

/**
 * A wrapper around OSTRICH to provide semantic querying capabilities.
 */
export class SemanticOstrich {

  init(path, readonly) {
    return new Promise((resolve, reject) => {
      ostrich.fromPath(path, !!readonly, async (error, store) => {
        if (error) {
          return reject(error);
        }
        this._promisifyStore(store);
        this._store = store;
        resolve();
      });
    });
  }

  close() {
    this._store.close();
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

  async semanticSearchTriplesVersionMaterialized(rules, s, p, o, options) {
    const pattern = { subject: s || '?s', predicate: p || '?p', object: o || '?o' };
    // Collect all applicable rules to the pattern, and instantiate them for the pattern
    const appliedRules = this.getApplicableRules(rules, pattern);

    // Get results from original pattern
    let triples = await this._store.searchTriplesVersionMaterialized(s, p, o, options);

    // Infer triples from rules
    let reasonTriples = triples;
    while (reasonTriples.length > 0) {
      const inferredTriples = await this.inferTriples(reasonTriples, appliedRules,
        async (s, p, o) => await this._store.searchTriplesVersionMaterialized(s, p, o, options));
      reasonTriples = inferredTriples;
      triples = triples.concat(inferredTriples)
    }

    return triples;
  }

  async semanticSearchTriplesDeltaMaterialized(rules, s, p, o, options) {
    const pattern = { subject: s || '?s', predicate: p || '?p', object: o || '?o' };
    // Collect all applicable rules to the pattern, and instantiate them for the pattern
    const appliedRules = this.getApplicableRules(rules, pattern);

    // Get results from original pattern
    let triples = await this._store.searchTriplesDeltaMaterialized(s, p, o, options);

    // Infer triples from rules
    let reasonTriples = triples;
    while (reasonTriples.length > 0) {
      const inferredTriples = await this.inferTriples(reasonTriples, appliedRules,
        async (s, p, o) => await this._store.searchTriplesVersionMaterialized(s, p, o, options));
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

  async semanticSearchTriplesVersion(rules, s, p, o, options) {
    const pattern = { subject: s || '?s', predicate: p || '?p', object: o || '?o' };
    // Collect all applicable rules to the pattern, and instantiate them for the pattern
    const appliedRules = this.getApplicableRules(rules, pattern);

    // Get results from original pattern
    let triples = await this._store.searchTriplesVersion(s, p, o, options);

    // Infer triples from rules
    let reasonTriples = triples;
    while (reasonTriples.length > 0) {
      const inferredTriples = await this.inferTriples(reasonTriples, appliedRules,
        async (s, p, o) => await this._store.searchTriplesVersion(s, p, o, options));
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

}