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

const REPLICATIONS = 5;
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

  await evaluate();
}
run().catch(console.error);

async function time(func) {
  const start = process.hrtime();
  let ret;
  for (let i = 0; i < REPLICATIONS; i++) {
    ret = await func();
  }
  const elapsed = process.hrtime(start)[1] / 1000000;
  return ((process.hrtime(start)[0] * 1000 + elapsed) / REPLICATIONS);// + " (" + ret + ")";
}

async function evaluate() {
  const store1 = new SemanticOstrich();
  await store1.init('./data/evalrun-bearb-day.ostrich', true);

  const store2 = new SemanticOstrich();
  await store2.init('./data/evalrun-bearb-day-typed.ostrich', true);

  // 31805/48914 = 65,02% => 34,98% triple savings

  // Warmup
  for (let i = 0; i < 10; i++) {
    await store1._store.searchTriplesVersionMaterialized(null, RDF + 'type', null, { version: 10, limit: 10 });
    await store2._store.searchTriplesVersionMaterialized(null, RDF + 'type', null, { version: 10, limit: 10 });
  }

  // For when we want to query ALL typed subjects
  /*const typedResources = _.uniq((await store1._store.searchTriplesVersion(null, RDF + 'type', null))
    .map((triple) => triple.subject));
  console.log(typedResources.length);
  */

  console.log("| Query | Original | Reduced | Inferred |");
  let timeOriginalTotal = 0;
  let timeReducedTotal = 0;
  let timeInferredTotal = 0;
  for (const subject of SUBJECTS) {
    const s = subject;
    const p = RDF + 'type';
    const o = null;
    const opts = { version: V };

    const timeOriginal = await time(async () => (await store1._store.searchTriplesVersionMaterialized(s, p, o, opts)).length);
    const timeReduced = await time(async () => (await store2._store.searchTriplesVersionMaterialized(s, p, o, opts)).length);
    const timeInferred = await time(async () => (await store2.semanticSearchTriplesVersionMaterialized(RULES, s, p, o, opts)).length);
    console.log("| %s | %s | %s | %s |", subject, timeOriginal, timeReduced, timeInferred);

    timeOriginalTotal += timeOriginal;
    timeReducedTotal += timeReduced;
    timeInferredTotal += timeInferred;
  }
  console.log("| %s | %s | %s | %s |", "AVERAGE", timeOriginalTotal / SUBJECTS.length, timeReducedTotal / SUBJECTS.length, timeInferredTotal / SUBJECTS.length);

  store1.close();
  store2.close();
}

async function compareDatasets() {
  const store1 = new SemanticOstrich();
  await store1.init('./data/evalrun-bearb-day.ostrich', true);

  const store2 = new SemanticOstrich();
  await store2.init('./data/evalrun-bearb-day-typed.ostrich', true);

  console.log("1: " + store1._store.maxVersion);
  console.log("2: " + store2._store.maxVersion);

  for (let i = 0; i <= store1._store.maxVersion; i++) {
    const t1 = (await store1._store.searchTriplesDeltaMaterialized(null, null, null, { versionStart: i, versionEnd: i + 1 })).length;
    const t2 = (await store2._store.searchTriplesDeltaMaterialized(null, null, null, { versionStart: i, versionEnd: i + 1 })).length;

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
  await store.init('./data/evalrun-bearb-day.ostrich', true);

  const storeNew = new SemanticOstrich();
  if (!fs.existsSync('./data/evalrun-bearb-day-typed.ostrich')) {
    fs.mkdirSync('./data/evalrun-bearb-day-typed.ostrich');

    await storeNew.init('./data/evalrun-bearb-day-typed.ostrich');

    const allTypes = {};
    for (let version = 0; version <= store._store.maxVersion; version++) {
      console.log("Version: " + version);
      let triples = [];

      // Add subclass mappings in version 0.
      if (version === 0) {
        for (const sub of Object.keys(SUBCLASSES)) {
          const sup = SUBCLASSES[sub];
          triples.push({ subject: sub, predicate: RDFS + 'subClassOf', object: sup, addition: true });
        }
      }

      // Retrieve original triples
      let triplesNew;
      if (version === 0) {
        triplesNew = (await store._store.searchTriplesVersionMaterialized(null, null, null, { version: version }))
          .map((triple) => {
            triple.addition = true;
            return triple;
          });
      } else {
        triplesNew = (await store._store.searchTriplesDeltaMaterialized(null, null, null,
          { versionStart: version - 1, versionEnd: version }));
      }

      // Filter triples away that can be inferred
      const total = triplesNew.length;
      triples = triples.concat(triplesNew
        .filter((triple) => {
          if (triple.predicate === RDF + 'type') {
            allTypes[triple.object] = true;
            return LEAF_CLASSES.indexOf(triple.object) >= 0;
          }
          return true;
        }));

      const added = await storeNew._store.append(version, triples);
      console.log("Added " + added + " / " + total + " to version " + version);
    }

    console.log("All types:");
    console.log(Object.keys(allTypes)); // TODO

    storeNew.close();
    store.close();
  } else {
    throw new Error('Store already exists');
  }
}
