Real output from `graphify extract . --code-only` (graphify 0.9.49), kept as a
fixture so the Brain Graph summary is tested against the schema graphify really
writes — node-link JSON where the edge list is `links`, not `edges` — instead of
one we assumed. Regenerate by running graphify on any small project and copying
its `graphify-out/graph.json` + `manifest.json` here.
