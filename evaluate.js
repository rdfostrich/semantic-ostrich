const {SemanticOstrich} = require('./lib/SemanticOstrich');
const _ = require('lodash');
const fs = require('fs');

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

// Subclass -> Superclass
// http://mappings.dbpedia.org/server/ontology/classes/
const SUBCLASSES = {
  'http://www.ontologydesignpatterns.org/ont/dul/DUL.owl#Event': 'http://www.w3.org/2002/07/owl#Thing',
  'http://dbpedia.org/ontology/TelevisionSeason': 'http://dbpedia.org/ontology/Work',
  'http://dbpedia.org/ontology/Work': 'http://schema.org/CreativeWork',
  'http://schema.org/CreativeWork': 'http://www.wikidata.org/entity/Q386724',
  'http://www.wikidata.org/entity/Q386724': 'http://www.w3.org/2002/07/owl#Thing',
  'http://dbpedia.org/ontology/Country': 'http://schema.org/Country',
  'http://dbpedia.org/ontology/Location': 'http://www.w3.org/2002/07/owl#Thing',
  'http://dbpedia.org/ontology/Place': 'http://www.w3.org/2003/01/geo/wgs84_pos#SpatialThing',
  'http://dbpedia.org/ontology/PopulatedPlace': 'http://www.wikidata.org/entity/Q486972',
  'http://schema.org/Country': 'http://www.wikidata.org/entity/Q6256',
  'http://schema.org/Place': 'http://www.w3.org/2002/07/owl#Thing',
  'http://www.w3.org/2003/01/geo/wgs84_pos#SpatialThing': 'http://schema.org/Place',
  'http://www.wikidata.org/entity/Q486972': 'http://dbpedia.org/ontology/Place',
  'http://www.wikidata.org/entity/Q6256': 'http://dbpedia.org/ontology/PopulatedPlace',
  'http://dbpedia.org/ontology/ArchitecturalStructure': 'http://dbpedia.org/ontology/Place',
  'http://dbpedia.org/ontology/Building': 'http://www.wikidata.org/entity/Q41176',
  'http://www.wikidata.org/entity/Q41176': 'http://dbpedia.org/ontology/ArchitecturalStructure',
  'http://xmlns.com/foaf/0.1/Person': 'http://schema.org/Person',
  'http://dbpedia.org/ontology/MusicalWork': 'http://www.wikidata.org/entity/Q2188189',
  'http://dbpedia.org/ontology/Single': 'http://www.wikidata.org/entity/Q134556',
  'http://www.wikidata.org/entity/Q134556': 'http://dbpedia.org/ontology/MusicalWork',
  'http://www.wikidata.org/entity/Q2188189': 'http://dbpedia.org/ontology/Work',
  'http://dbpedia.org/ontology/TelevisionShow': 'http://www.wikidata.org/entity/Q15416',
  'http://www.wikidata.org/entity/Q15416': 'http://dbpedia.org/ontology/Work',
  'http://dbpedia.org/ontology/Agent': 'http://www.w3.org/2002/07/owl#Thing',
  'http://dbpedia.org/ontology/Athlete': 'http://www.ontologydesignpatterns.org/ont/dul/DUL.owl#NaturalPerson',
  'http://dbpedia.org/ontology/Person': 'http://xmlns.com/foaf/0.1/Person',
  'http://dbpedia.org/ontology/SoccerPlayer': 'http://www.wikidata.org/entity/Q937857',
  'http://schema.org/Person': 'http://www.wikidata.org/entity/Q215627',
  'http://www.ontologydesignpatterns.org/ont/dul/DUL.owl#Agent': 'http://dbpedia.org/ontology/Agent',
  'http://www.ontologydesignpatterns.org/ont/dul/DUL.owl#NaturalPerson': 'http://dbpedia.org/ontology/Person',
  'http://www.wikidata.org/entity/Q215627': 'http://www.wikidata.org/entity/Q5',
  'http://www.wikidata.org/entity/Q5': 'http://www.ontologydesignpatterns.org/ont/dul/DUL.owl#Agent',
  'http://www.wikidata.org/entity/Q937857': 'http://dbpedia.org/ontology/Athlete',
  'http://dbpedia.org/ontology/Election': 'http://www.wikidata.org/entity/Q40231',
  'http://dbpedia.org/ontology/Event': 'http://schema.org/Event',
  'http://dbpedia.org/ontology/SocietalEvent': 'http://dbpedia.org/ontology/Event',
  'http://schema.org/Event': 'http://www.wikidata.org/entity/Q1656682',
  'http://www.wikidata.org/entity/Q1656682': 'http://www.w3.org/2002/07/owl#Thing',
  'http://www.wikidata.org/entity/Q40231': 'http://dbpedia.org/ontology/SocietalEvent',
  'http://dbpedia.org/ontology/TimePeriod': 'http://www.ontologydesignpatterns.org/ont/dul/DUL.owl#TimeInterval',
  'http://dbpedia.org/ontology/Year': 'http://www.wikidata.org/entity/Q577',
  'http://www.ontologydesignpatterns.org/ont/dul/DUL.owl#TimeInterval': 'http://www.w3.org/2002/07/owl#Thing',
  'http://www.wikidata.org/entity/Q577': 'http://dbpedia.org/ontology/TimePeriod',
};
// The classes using which all other classes can be inferred
const LEAF_CLASSES = Object.keys(SUBCLASSES).filter((clazz) => {
  if (!SUBCLASSES[clazz]) {
    return true;
  }
  for (const clazzValue in SUBCLASSES) {
    if (SUBCLASSES[clazzValue] === clazz) {
      return false;
    }
  }
  return true;
});

const REPLICATIONS = 20;
const V = 88;
const SUBJECTS = [
  'http://dbpedia.org/resource/Palazzo_Parisio_(Valletta)',
  'http://dbpedia.org/resource/Singaporean_general_election,_2015',
  'http://dbpedia.org/resource/What_Do_You_Mean%3F',
  'http://dbpedia.org/resource/Dancing_with_the_Stars_(U.S._season_21)',
  'http://dbpedia.org/resource/Doctor_Who_(series_9)',
  'http://dbpedia.org/resource/My_Little_Pony:_Equestria_Girls_%E2%80%93_Friendship_Games', // TODO: rm?
  'http://dbpedia.org/resource/2015'
]; // These are the subjects that have at least one inferrable rdf:type in version V

async function run() {
  //await generateTypedDataset();

  //await compareDatasets();

  await evaluateAll();
}
run().catch(console.error);

// Time in ms
async function time(func) {
  const start = process.hrtime();
  let ret;
  for (let i = 0; i < REPLICATIONS; i++) {
    ret = await func();
  }
  const elapsed = process.hrtime(start)[1] / 1000000;
  return ((process.hrtime(start)[0] * 1000 + elapsed) / REPLICATIONS);// + " (" + ret + ")";
}

async function evaluateAll() {
  console.log("## S-VM");
  await evaluate(
    async (store1, s, p, o) => (await store1._storeDataset.searchTriplesVersionMaterialized(s, p, o, { version: V })),
    async (store2, s, p, o) => (await store2._storeDataset.searchTriplesVersionMaterialized(s, p, o, { version: V })),
    async (store2, s, p, o) => (await store2.semanticSearchTriplesVersionMaterialized(RULES, s, p, o, { version: V }, { version: 0 }))
  );
  console.log();

  console.log("## S-DM");
  await evaluate(
    async (store1, s, p, o) => (await store1._storeDataset.searchTriplesDeltaMaterialized(s, p, o, { versionStart: 0, versionEnd: V })),
    async (store2, s, p, o) => (await store2._storeDataset.searchTriplesDeltaMaterialized(s, p, o, { versionStart: 0, versionEnd: V })),
    async (store2, s, p, o) => (await store2.semanticSearchTriplesDeltaMaterialized(RULES, s, p, o, { versionStart: 0, versionEnd: V }, { versionStart: -1, versionEnd: 0 }))
  );
  console.log();

  console.log("## S-VQ");
  await evaluate(
    async (store1, s, p, o) => (await store1._storeDataset.searchTriplesVersion(s, p, o)),
    async (store2, s, p, o) => (await store2._storeDataset.searchTriplesVersion(s, p, o)),
    async (store2, s, p, o) => (await store2.semanticSearchTriplesVersion(RULES, s, p, o))
  );
  console.log();
}

async function evaluate(queryerOriginal, queryerReduced, queryerInferred) {
  const store1 = new SemanticOstrich();
  await store1.init('./data/evalrun-bearb-day.ostrich', null, true);

  const store2 = new SemanticOstrich();
  await store2.init('./data/evalrun-bearb-day-data.ostrich', './data/evalrun-bearb-day-language.ostrich', true);

  // 31805/48914 = 65,02% => 34,98% triple savings

  // Warmup
  for (let i = 0; i < 10; i++) {
    await store1._storeDataset.searchTriplesVersionMaterialized(null, RDF + 'type', null, { version: 10, limit: 10 });
    await store2._storeDataset.searchTriplesVersionMaterialized(null, RDF + 'type', null, { version: 10, limit: 10 });
    await store2._storeLanguage.searchTriplesVersionMaterialized(null, RDF + 'type', null, { version: 0, limit: 10 });
  }

  // For when we want to query ALL typed subjects
  /*const typedResources = _.uniq((await store1._store.searchTriplesVersion(null, RDF + 'type', null))
    .map((triple) => triple.subject));
  console.log(typedResources.length);
  */

  console.log("| Query | Original | Reduced | Inferred | Inference queries | Inferred normalized |");
  let timeOriginalTotal = 0;
  let timeReducedTotal = 0;
  let timeInferredTotal = 0;
  let inferenceQueriesTotal = 0;
  let timeInferredNormalizedTotal = 0;
  for (const subject of SUBJECTS) {
    const s = subject;
    const p = RDF + 'type';
    const o = null;

    const timeOriginal = await time(async () => (await queryerOriginal(store1, s, p, o)).length);
    const timeReduced = await time(async () => (await queryerReduced(store2, s, p, o)).length);
    const timeInferred = await time(async () => (await queryerInferred(store2, s, p, o)).length);
    const inferenceQueries = store2.lastQueryCount;
    const timeInferredNormalized = timeInferred / store2.lastQueryCount;
    console.log("| %s | %s | %s | %s | %s | %s |", subject, timeOriginal, timeReduced, timeInferred,
      inferenceQueries, timeInferredNormalized);

    timeOriginalTotal += timeOriginal;
    timeReducedTotal += timeReduced;
    timeInferredTotal += timeInferred;
    inferenceQueriesTotal += inferenceQueries;
    timeInferredNormalizedTotal += timeInferredNormalized;
  }
  console.log("| %s | %s | %s | %s | %s | %s |", "AVERAGE", timeOriginalTotal / SUBJECTS.length,
    timeReducedTotal / SUBJECTS.length, timeInferredTotal / SUBJECTS.length, inferenceQueriesTotal / SUBJECTS.length,
    timeInferredNormalizedTotal / SUBJECTS.length);

  store1.close();
  store2.close();
}

async function compareDatasets() {
  const store1 = new SemanticOstrich();
  await store1.init('./data/evalrun-bearb-day.ostrich', null, true);

  const store2 = new SemanticOstrich();
  await store2.init('./data/evalrun-bearb-day-data.ostrich', './data/evalrun-bearb-day-language.ostrich', true);

  console.log("1: " + store1._storeDataset.maxVersion);
  console.log("2: " + store2._storeDataset.maxVersion + "; " + store2._storeLanguage.maxVersion);

  for (let i = 0; i <= store1._storeDataset.maxVersion; i++) {
    const t1 = (await store1._storeDataset.searchTriplesDeltaMaterialized(null, null, null, { versionStart: i, versionEnd: i + 1 })).length;
    const t2 = (await store2._storeDataset.searchTriplesDeltaMaterialized(null, null, null, { versionStart: i, versionEnd: i + 1 })).length;

    console.log("V: " + i); // TODO
    console.log(t1);
    console.log(t2);
  }

  store1.close();
  store2.close();
}

/*
The DBpedia dataset contains all RDF superclass inferences
This creates a dataset where only the most specific type is kept,
so our benchmark can infer these same inferences, without having to store them explicitly.
 */
async function generateTypedDataset() {
  const store = new SemanticOstrich();
  await store.init('./data/evalrun-bearb-day.ostrich', null, true);

  const storeNew = new SemanticOstrich();
  if (!fs.existsSync('./data/evalrun-bearb-day-data.ostrich')) {
    fs.mkdirSync('./data/evalrun-bearb-day-data.ostrich');

    await storeNew.init('./data/evalrun-bearb-day-data.ostrich', './data/evalrun-bearb-day-language.ostrich');

    const allTypes = {};
    for (let version = 0; version <= store._storeDataset.maxVersion; version++) {
      console.log("Version: " + version);
      let triplesDataset = [];
      let triplesLanguage = [];

      // Retrieve original triples
      let triplesNew;
      if (version === 0) {
        triplesNew = (await store._storeDataset.searchTriplesVersionMaterialized(null, null, null, { version: version }))
          .map((triple) => {
            triple.addition = true;
            return triple;
          });
      } else {
        triplesNew = (await store._storeDataset.searchTriplesDeltaMaterialized(null, null, null,
          { versionStart: version - 1, versionEnd: version }));
      }

      // Filter triples away that can be inferred
      const total = triplesNew.length;
      triplesDataset = triplesNew
        .filter((triple) => {
          if (triple.predicate === RDF + 'type') {
            allTypes[triple.object] = true;
            return LEAF_CLASSES.indexOf(triple.object) >= 0;
          }
          return true;
        });

      const addedDataset = await storeNew._storeDataset.append(version, triplesDataset);
      console.log("Added " + addedDataset + " / " + total + " dataset triples to version " + version);

      // Add subclass mappings in version 0.
      if (version === 0) {
        for (const sub of Object.keys(SUBCLASSES)) {
          const sup = SUBCLASSES[sub];
          triplesLanguage.push({ subject: sub, predicate: RDFS + 'subClassOf', object: sup, addition: true });
        }

        const addedLanguage = await storeNew._storeLanguage.append(version, triplesLanguage);
        console.log("Added " + addedLanguage + " language triples to version " + version);
      }
    }

    console.log("All types:");
    console.log(Object.keys(allTypes)); // TODO

    storeNew.close();
    store.close();
  } else {
    throw new Error('Store already exists');
  }
}
