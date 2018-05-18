# Semantic Versioning with OSTRICH

This is a prototypical proof-of-concept implementation for semantic versioned querying.
It is implemented on top of the versioned triple store, [OSTRICH](https://github.com/rdfostrich/ostrich/).
An additional layer is able to perform inferencing based on a set of rules.

## Run on command line

This package ships with a command line tool to execute semantic triple pattern queries against
OSTRICH dataset and language stores, based on a set of inference rules. 

The following executes a semantic version materialization on dataset version 88 and language version 0
for the triple pattern `<http://dbpedia.org/resource/Doctor_Who_(series_9)> <http://www.w3.org/1999/02/22-rdf-syntax-ns#type> ?o`.
This will use the [N3 rules](https://en.wikipedia.org/wiki/Notation3) from `rules.n3`.

```
$ semantic-ostrich bin/semantic-ostrich data/evalrun-bearb-day-data.ostrich/ data/evalrun-bearb-day-language.ostrich/ rules.n3 --vd 88 --vl 0 --qvm '<http://dbpedia.org/resource/Doctor_Who_(series_9)> <http://www.w3.org/1999/02/22-rdf-syntax-ns#type> ?o'
```

For example, a rules file could contain this:
```
{
  ?c <http://www.w3.org/2000/01/rdf-schema#subClassOf> ?d.
  ?x a ?c.
} => {
  ?x a ?d.
}.
```

For more information on the command line tool, call `semantic-ostrich --help`.

## License
This software is written by [Ruben Taelman](http://rubensworks.net/).

This code is copyrighted by [Ghent University – imec](http://idlab.ugent.be/)
and released under the [MIT license](http://opensource.org/licenses/MIT).
