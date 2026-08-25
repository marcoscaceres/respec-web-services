import {
  search as _search,
  cache,
} from "../../../../build/routes/xref/lib/search.js";
import { buildTermLowerIndex } from "../../../../build/routes/xref/lib/store.js";

import byTerm from "./data-by-term.js";
import bySpec from "./data-by-spec.js";

// Minimal specmap matching production shape: { [group]: { [specid]: { shortname, url, title } } }
const specmap = {
  current: {
    "referrer-policy-1": { url: "", shortname: "referrer-policy", title: "Referrer Policy" },
    "font-metrics-api-1": { url: "", shortname: "font-metrics-api", title: "Font Metrics API" },
    "css-cascade-3": { url: "", shortname: "css-cascade", title: "CSS Cascading Level 3" },
    "css-cascade-4": { url: "", shortname: "css-cascade", title: "CSS Cascading Level 4" },
    "css-lists-3": { url: "", shortname: "css-lists", title: "CSS Lists Level 3" },
    "web-bluetooth-1": { url: "", shortname: "web-bluetooth", title: "Web Bluetooth" },
    "wai-aria-1.2": { url: "", shortname: "wai-aria", title: "WAI-ARIA 1.2" },
  },
  snapshot: {},
};

const store = { byTerm, bySpec, specmap, byTermLower: buildTermLowerIndex(byTerm) };

/**
 * @param {import("../../../../routes/xref/lib/search.js").Query} query
 * @param {import("../../../../routes/xref/lib/search.js").Options} options
 */
const search = (query, options) => {
  const response = _search([query], store, { fields: ["uri"], ...options });
  return response.result[0][1];
};

describe("xref - search", () => {
  beforeEach(() => cache.clear());

  // Regression: `query.id` was used directly as the key of the process-wide, 3-day
  // MemCache, and the id a client omits is a deterministic hash of the query — so a
  // caller could compute an honest client's key and seed it with another term's
  // results. The key must cover everything filter() reads, and nothing a caller sends.
  describe("cache key", () => {
    const uris = query => search(query).map(entry => entry.uri);
    const script = [
      "interact.html#elementdef-script",
      "scripting.html#script",
      "webappapis.html#concept-script",
      "script.html#ScriptElement",
    ];

    it("does not let a caller-supplied id poison another query", () => {
      // The id an honest `{ term: "script" }` request gets assigned.
      const honestKey = _search([{ term: "script" }], store, { query: true })
        .query[0].id;
      cache.clear();

      uris({ term: "body", id: honestKey }); // attacker seeds that key
      expect(uris({ term: "script" })).toEqual(script);
    });

    it("keys on the query, so two terms sharing an id stay distinct", () => {
      expect(uris({ term: "body", id: "same" })).not.toEqual(
        uris({ term: "script", id: "same" }),
      );
    });

    // Without this, keying on a caller-supplied (or id-inclusive) hash silently
    // defeats the cache: every distinct id is a miss, and each miss adds an entry to
    // an unbounded Map with a 3-day TTL.
    it("reuses one entry for the same query under different ids", () => {
      spyOn(cache, "set").and.callThrough();
      uris({ term: "baseline", id: "req-1" });
      uris({ term: "baseline", id: "req-2" });
      expect(cache.set).toHaveBeenCalledTimes(1);
    });

    // Every query field filter() reads has to be in the key, or a query that differs
    // only by that field reads the other one's entry.
    it("separates entries that differ only by types, specs or for", () => {
      const pairs = [
        ["types", { term: "script", types: ["dfn"] }, { term: "script", types: ["element"] }],
        ["specs", { term: "body", specs: [["fetch"]] }, { term: "body", specs: [["html"]] }],
        ["for", { term: "event", for: "Window" }, { term: "event", for: "HTMLScriptElement" }],
      ];
      for (const [field, seed, query] of pairs) {
        cache.clear();
        const alone = uris(query);
        cache.clear();
        uris(seed);
        expect(uris(query)).withContext(field).toEqual(alone);
      }
    });

    // `options.all` changes what filter() returns (via filterByForContext), and the
    // GET and POST routes pass different values, so it has to be part of the key.
    it("separates entries that differ only by options.all", () => {
      const scoped = { term: "script" };
      const restrictive = search(scoped, { all: false }).length;
      cache.clear();
      search(scoped, { all: true });
      expect(search(scoped, { all: false }).length).toBe(restrictive);
    });
  });

  describe("options", () => {
    describe("query", () => {
      it("adds query back to response if requested", () => {
        expect(_search([], store, { query: true })).toEqual({
          result: [],
          query: [],
        });
        expect(_search([], store)).toEqual({ result: [] });
      });

      it("adds id to query if none is given", () => {
        const getQuery = query =>
          _search([query], store, { query: true }).query[0];
        expect(getQuery({ term: "html" })).toEqual({
          term: "html",
          id: "4c0b68a3658fd64c8a77242fffd6e4e615331375",
          types: [],
        });
        expect(getQuery({ term: "html", id: "ID" })).toEqual({
          term: "html",
          id: "ID",
          types: [],
        });
      });
    });

    describe("fields", () => {
      const search = (q, opts) => _search([q], store, { ...opts }).result[0][1];

      it("returns only requested fields", () => {
        expect(
          search({ term: "Baseline" }, { fields: ["spec", "uri"] }),
        ).toEqual([{ spec: "font-metrics-api-1", uri: "#baseline" }]);
      });

      it("returns default fields if not specified", () => {
        expect(search({ term: "Baseline" })).toEqual([
          {
            shortname: "font-metrics-api",
            spec: "font-metrics-api-1",
            type: "interface",
            uri: "#baseline",
            normative: true,
            htmlProse: "test html Prose",
            for: undefined,
          },
        ]);
      });
    });

    describe("all", () => {
      const resultsAll = [
        { uri: "#concept-event" },
        { uri: "#dom-window-event" },
        { uri: "obsolete.html#dom-script-event" },
      ];

      it("skips filter@for if options.all is set and for is not provided", () => {
        expect(search({ term: "event" }, { all: true })).toEqual(resultsAll);
      });

      it("uses filter@for if options.all is set and for is provided", () => {
        expect(search({ term: "event", for: "Window" }, { all: true })).toEqual(
          [resultsAll[1]],
        );
      });

      it("uses filter@for if options.all is not set", () => {
        expect(search({ term: "event", for: "Window" })).toEqual([
          resultsAll[1],
        ]);
      });
    });
  });

  describe("backward compatibility", () => {
    it("allows query.specs as string[]", () => {
      const inputQuery = { specs: ["html"], id: "ID" };
      const outputQuery = _search([inputQuery], store, { query: true })
        .query[0];
      expect(outputQuery).toEqual({ specs: [["html"]], id: "ID", types: [] });
    });
  });

  describe("filter@term", () => {
    it("empty string", () => {
      const result = [{ uri: "#dom-referrerpolicy" }];
      expect(search({ term: "", for: "ReferrerPolicy" })).toEqual(result);
      expect(search({ term: '""', for: "ReferrerPolicy" })).toEqual(result);
      expect(search({ term: "''", for: "ReferrerPolicy" })).toEqual([]);
    });

    it("textVariations", () => {
      const types = ["dfn"];
      const result = [{ uri: "webappapis.html#event-handlers" }];
      expect(search({ term: "event handler" })).toEqual(result);
      expect(search({ term: "event handlers" })).toEqual([]);
      expect(search({ term: "event handlers", types })).toEqual(result);

      const resultInfra = { uri: "#user-agent" };
      const resultWaiAria = { uri: "#dfn-user-agent" };
      expect(
        search({ term: "user agents", specs: [["infra"]], types }),
      ).toEqual([resultInfra]);
      expect(search({ term: "user agent", specs: [["infra"]], types })).toEqual(
        [resultInfra],
      );
      expect(
        search({ term: "user agents", specs: [["infra", "wai-aria"]], types }),
      ).toEqual([resultWaiAria]);
      expect(
        search({ term: "user agent", specs: [["infra", "wai-aria"]], types }),
      ).toEqual([resultWaiAria, resultInfra]);
    });

    it("preserves case based on query.types", () => {
      const baseline = [{ uri: "text.html#TermBaseline" }];
      const baselineInterface = [{ uri: "#baseline" }];
      const baselineBoth = [
        { uri: "text.html#TermBaseline" },
        { uri: "#baseline" },
      ];

      expect(search({ term: "baseline" })).toEqual(baseline);
      // Case-insensitive fallback finds all variants
      expect(search({ term: "baseLine" })).toEqual(baselineBoth);

      expect(search({ term: "baseLine", types: ["dfn"] })).toEqual(baseline);
      // IDL is case-sensitive: "baseLine" must not match "Baseline"
      expect(search({ term: "baseLine", types: ["_IDL_"] })).toEqual([]);

      expect(search({ term: "Baseline", types: ["dfn"] })).toEqual(baseline);
      expect(search({ term: "Baseline", types: ["_IDL_"] })).toEqual(
        baselineInterface,
      );
    });

    it("includes canonical term on case-insensitive fallback hits", () => {
      // When the case-insensitive fallback fires, each result entry should
      // include the canonical term it was indexed under, so cite syntax can
      // use the correct casing instead of the user's input.
      const searchWithTerm = query => {
        const response = _search([query], store, { fields: ["uri", "term"] });
        return response.result[0][1];
      };

      // Exact match: no term field (not a fallback hit)
      const exact = searchWithTerm({ term: "baseline" });
      expect(exact).toEqual([
        { uri: "text.html#TermBaseline", term: undefined },
      ]);

      // Case-insensitive fallback: term field present with canonical casing
      const fallback = searchWithTerm({ term: "baseLine" });
      expect(fallback).toEqual([
        { uri: "text.html#TermBaseline", term: "baseline" },
        { uri: "#baseline", term: "Baseline" },
      ]);
    });

    it("preserves case for element-type queries", () => {
      const foreignObject = [{ uri: "embedded.html#elementdef-foreignObject" }];
      expect(search({ term: "foreignObject", types: ["element"] })).toEqual(
        foreignObject,
      );
      expect(search({ term: "foreignObject", types: ["_CONCEPT_"] })).toEqual(
        foreignObject,
      );
      expect(
        search({ term: "foreignObject", types: ["element", "dfn"] }),
      ).toEqual(foreignObject);

      const clipPath = [{ uri: "masking.html#elementdef-clipPath" }];
      expect(search({ term: "clipPath", types: ["element"] })).toEqual(
        clipPath,
      );
      expect(search({ term: "clipPath", types: ["_CONCEPT_"] })).toEqual(
        clipPath,
      );
      expect(search({ term: "clipPath", types: ["element", "dfn"] })).toEqual(
        clipPath,
      );
    });

    it("resolves a canonical concept shadowed by a for-scoped lowercase term", () => {
      // Regression: [=URL=] sends term "url" (concepts are lowercased). The
      // canonical URL concept is indexed under "URL"; a distinct for-scoped
      // "url" (basic URL parser local variable) exists under the lowercase key.
      // The lowercase direct hit must not shadow the canonical concept...
      expect(search({ term: "url", types: ["_CONCEPT_"] })).toEqual([
        { uri: "#concept-url" },
      ]);
      // ...but the for-scoped entry still wins when its for is given.
      expect(
        search({ term: "url", types: ["_CONCEPT_"], for: "basic URL parser" }),
      ).toEqual([{ uri: "#basic-url-parser-url" }]);
    });
  });

  describe("filter@specs", () => {
    it("skips filter if query.specs not provided", () => {
      const results = search({ term: "script" }).sort((a, b) =>
        a.uri.localeCompare(b.uri),
      );
      const expectedResults = [
        { uri: "interact.html#elementdef-script" },
        { uri: "script.html#ScriptElement" },
        { uri: "scripting.html#script" },
        { uri: "webappapis.html#concept-script" },
      ].sort((a, b) => a.uri.localeCompare(b.uri));

      expect(results).toEqual(expectedResults);
    });

    it("filters on spec id first, then on shortname", () => {
      const term = "inherited value";
      const options = { fields: ["spec", "uri"] };
      expect(search({ term, specs: [["css-cascade-3"]] }, options)).toEqual([
        { spec: "css-cascade-3", uri: "#inherited-value" },
      ]);

      expect(search({ term, specs: [["css-cascade-4"]] }, options)).toEqual([
        { spec: "css-cascade-4", uri: "#inherited-value" },
      ]);
    });

    it("prefers latest version of same spec", () => {
      const term = "inherited value";
      const options = { fields: ["spec", "uri"] };
      expect(search({ term, specs: [["css-cascade"]] }, options)).toEqual([
        { spec: "css-cascade-4", uri: "#inherited-value" },
      ]);
    });

    it("supports fallback chains", () => {
      expect(search({ term: "script", specs: [["dom"], ["svg2"]] })).toEqual([
        { uri: "interact.html#elementdef-script" },
      ]);

      expect(search({ term: "body", specs: [["fetch"], ["html"]] })).toEqual([
        { uri: "#concept-body" },
      ]);
    });
  });

  describe("filter@types", () => {
    const resultMarker = [
      { uri: "#marker" },
      { uri: "painting.html#elementdef-marker" },
      { uri: "painting.html#MarkerElement" },
    ];

    it("skips filter if types are not provided", () => {
      const withoutTypes = [resultMarker[1], resultMarker[0], resultMarker[2]];
      expect(search({ term: "marker" })).toEqual(withoutTypes);
      expect(search({ term: "marker", types: [] })).toEqual(withoutTypes);
    });

    it("uses basic types filter", () => {
      const asDFN = [resultMarker[0]];
      expect(search({ term: "marker", types: ["dfn"] })).toEqual(asDFN);

      const asElement = [resultMarker[1], resultMarker[2]];
      expect(search({ term: "marker", types: ["element"] })).toEqual(asElement);

      const asElementOrDFN = [
        resultMarker[1],
        resultMarker[0],
        resultMarker[2],
      ];
      expect(search({ term: "marker", types: ["element", "dfn"] })).toEqual(
        asElementOrDFN,
      );

      expect(search({ term: "Baseline", types: ["interface"] })).toEqual([
        { uri: "#baseline" },
      ]);
    });

    it("uses _CONCEPT_, _IDL_ aggregate types", () => {
      const asConcept = [resultMarker[1], resultMarker[0], resultMarker[2]];
      expect(search({ term: "marker", types: ["_CONCEPT_"] })).toEqual(
        asConcept,
      );

      expect(search({ term: "Baseline", types: ["_IDL_"] })).toEqual([
        { uri: "#baseline" },
      ]);
    });
  });

  describe("filter@for", () => {
    it("skips filter if for is not provided", () => {
      expect(search({ term: "[[context]]" })).toHaveSize(0);

      const result = [{ uri: "#concept-event" }];
      expect(search({ term: "event" })).toEqual(result);
      expect(search({ term: "event", for: "" })).toEqual(result);
    });

    it("uses for context", () => {
      expect(search({ term: "[[context]]", for: "BluetoothDevice" })).toEqual([
        { uri: "#dom-bluetoothdevice-context-slot" },
      ]);
      expect(search({ term: "[[context]]", for: "WhateverElse" })).toEqual([]);

      expect(search({ term: "event", for: "Window" })).toEqual([
        { uri: "#dom-window-event" },
      ]);
      expect(search({ term: "event", for: "HTMLScriptElement" })).toEqual([
        { uri: "obsolete.html#dom-script-event" },
      ]);
    });

    it("tries lowercase forContext for concepts", () => {
      expect(search({ term: "for each", for: "list" })).toEqual([
        { uri: "#list-iterate" },
      ]);

      expect(search({ term: "for each", for: "LisT" })).toEqual([
        { uri: "#list-iterate" },
      ]);

      expect(search({ term: "aborted", for: "AbortSignal" })).toEqual([
        { uri: "#dom-abortsignal-aborted" },
      ]);
      expect(search({ term: "aborted", for: "abortsignal" })).toEqual([]);
    });
  });

  describe("empty term with specs (browse all terms)", () => {
    it("returns all entries for a spec when term is empty", () => {
      const results = search(
        { term: "", specs: [["dom"]], id: "" },
        { all: true },
      );
      // dom has: EventInit (dictionary), event (dfn), event (attr for Window),
      // aborted (attr for AbortSignal)
      expect(results.length).toBeGreaterThan(0);
    });

    it("returns all entries for a spec filtered by type", () => {
      const results = search(
        { term: "", specs: [["dom"]], types: ["attribute"], id: "" },
        { all: true },
      );
      expect(results).toEqual([
        { uri: "#dom-window-event" },
        { uri: "#dom-abortsignal-aborted" },
      ]);
    });

    it("returns all entries for a spec filtered by aggregate type", () => {
      const results = search(
        { term: "", specs: [["dom"]], types: ["_IDL_"], id: "" },
        { all: true },
      );
      // _IDL_ includes: dictionary, attribute
      // dom has: EventInit (dictionary), event (attr), aborted (attr)
      expect(results).toEqual([
        { uri: "#dictdef-eventinit" },
        { uri: "#dom-window-event" },
        { uri: "#dom-abortsignal-aborted" },
      ]);
    });

    it("returns all enum-values for a spec (issue #278)", () => {
      const results = search(
        { term: "", specs: [["fetch"]], types: ["enum-value"], id: "" },
        { all: true },
      );
      const sorted = results.sort((a, b) => a.uri.localeCompare(b.uri));
      expect(sorted).toEqual([
        { uri: "#dom-requestdestination" },
        { uri: "#dom-requestdestination-script" },
      ]);
    });

    it("returns empty when term is empty and no specs are given", () => {
      // Without specs, empty term should use the normal byTerm[""] path
      const results = search({ term: "", id: "" });
      expect(results).toEqual([]);
    });

    it("filters by for context when browsing a spec", () => {
      const results = search({
        term: "",
        specs: [["dom"]],
        for: "Window",
        id: "",
      });
      expect(results).toEqual([{ uri: "#dom-window-event" }]);
    });

    it("combines multiple specs in a single fallback list", () => {
      const results = search(
        { term: "", specs: [["css-lists", "web-bluetooth"]], id: "" },
        { all: true },
      );
      expect(results.length).toBeGreaterThan(0);
    });

    it("resolves versioned spec ids to series shortname via specmap", () => {
      // css-lists-3 and web-bluetooth-1 are versioned spec ids; bySpec is keyed
      // by series shortname (css-lists, web-bluetooth), so collectBySpecs() must
      // resolve them via specmap to return results.
      const results = search(
        { term: "", specs: [["css-lists-3", "web-bluetooth-1"]], id: "" },
        { all: true },
      );
      expect(results.length).toBeGreaterThan(0);
    });
  });
});
