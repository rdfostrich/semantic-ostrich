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

const SUBJECT = 'http://dbpedia.org/resource/Doctor_Who_(series_9)';
const V = 88;

async function run() {
  //await generateTypedDataset();

  //await compareDatasets();

  const store = new SemanticOstrich();
  await store.init('./data/evalrun-bearb-day-typed.ostrich', true);

  // 31805/48914 = 65,02% => 34,98% triple savings

  // Warmup
  for (let i = 0; i < 10; i++) {
    await store._store.searchTriplesVersionMaterialized(SUBJECT, RDF + 'type', null, { version: V });
  }

  console.log("VM:");
  console.time('vm');
  console.log((await store._store.searchTriplesVersionMaterialized(SUBJECT, RDF + 'type', null, { version: V })).map(SemanticOstrich.tripleToString));
  console.timeEnd('vm');

  console.log("S-VM:");
  console.time('svm');
  console.log((await store.semanticSearchTriplesVersionMaterialized(RULES, SUBJECT, RDF + 'type', null, { version: V })).map(SemanticOstrich.tripleToString));
  console.timeEnd('svm');

  await store.close();
}
run().catch(console.error);

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
