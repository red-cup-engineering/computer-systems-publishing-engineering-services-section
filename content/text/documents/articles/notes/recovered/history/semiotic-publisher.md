---
title: Semiotic Publishing Script
id: semiotic-publishing-script
keywords:
  - semiotics
  - static-site-generator
  - document-publishing
type: doc
status: draft
publish_to:
  - emsenn-net
description: This is the documentation for the "semiotic publishing script," the thing I use to make my website and other documents.
---


This is the documentation for the "semiotic publishing script," the thing I use to make my website and other documents.

It works by treating a Markdown file as a [Stewardable Semiotic Concept Universe](Stewardable Semiotic Concept Universe), or combining a bunch of them into one universe.

---

## 1. High‑Level Overview

At a high level, the publisher does the following:

1. **Scan a vault** of Markdown files with YAML frontmatter.
2. **Parse concepts**: each file becomes a `Concept` with metadata, body, links, and annotations.
3. **Interpret annotations** into **atoms** (tags, folders, links, status, type, facts, temporal markers).
4. **Configure j‑relations**: a graph of implications between atoms (folder→tag, synonyms, status/type→tag).
5. **Compute fragments and semantics** by iterated closure under `j` and `G` (trace).
6. **Evaluate concepts** with a simple quantitative score based on semantic features.
7. **Build indices** (tag, folder, type, status) over the universe.
8. **Export** one or more targets:
   - `html`: a static site with an index and concept pages,
   - `json`: a static JSON API,
   - `rdf`: an RDF graph of concepts and atoms,
   - `openapi`: a static OpenAPI description of the JSON API,
   - `pandoc`: Markdown suitable for Pandoc (single concept or combined “book”).

The pipeline is driven from the CLI entrypoint and configured via a YAML file (`semiotic.config.yml`) plus command‑line overrides.

---

## 2. Concepts, Atoms, and the Universe

### 2.1 Concepts

Each Markdown file in the vault corresponds to a `Concept`:

- **ID**: derived from frontmatter `id`, or the relative path (slugified).
- **Title**: `title` from frontmatter, or the file stem.
- **Body**: the Markdown content (later rendered to HTML for the site and to Pandoc Markdown for documents).
- **Metadata**:
  - `tags`: list of free‑form tags;
  - `type`: concept type;
  - `status`: lifecycle or quality status;
  - `aliases`: alternative names;
  - `subjects` / `facts`: structured subject–predicate–object assertions;
  - `created`, `updated`: temporal metadata.
- **Structural context**:
  - `folders`: path segments from the vault root;
  - `links`: internal links from Markdown links and `[wikilinks](wikilinks)`.

All of this is assembled by `load_markdown_concept`, which uses an internal YAML frontmatter parser and a small wiki/Markdown link parser.

### 2.2 Atoms

Atoms are the finite **feature vocabulary** of the publisher:

- `tag:foo`
- `folder:research`
- `link:some-concept-id`
- `status:draft`, `type:definition`
- `alias:alternate-name`
- `fact:predicate:subject->object`
- `created:2025-01-01`, `created_year:2025`, `updated:…`, `updated_year:…`

Each `(kind, value)` pair is interned as a unique `Atom` with an integer ID.
The universe maintains:

- a map from `(kind, value)` to atom ID,
- the reverse map from ID to `Atom`, and
- relations between atoms (for `j`‑closure).

### 2.3 Universe

The `Universe` is the finite structure over which the publisher computes:

- `atoms`: all atoms that appear in any concept;
- `concepts`: mapping from concept ID to `Concept`;
- `j_relations`: adjacency information for the modal closure;
- `indices`: derived indices (`tag`, `folder`, `type`, `status`) built from semantic features;
- `config`: the configuration used to build this universe.

Although the theoretical universe is an infinite Heyting structure, this implementation uses a **finite feature set** (atoms) and a **graph closure** as an approximation.

---

## 3. From Frontmatter to Annotations and Features

### 3.1 Annotation Terms

The publisher treats frontmatter and structure as a tiny **annotation calculus**:

- `HasTag(tag)` for each frontmatter `tags` entry,
- `HasStatus(status)` for frontmatter `status`,
- `HasType(type)` for frontmatter `type`,
- `AliasFor(alias)` for frontmatter `aliases`,
- `InFolder(folder)` for each folder segment,
- `LinksTo(target)` for each internal link,
- `Fact(predicate, subject, object)` for frontmatter `facts`.

These are stored as `AnnotationTerm` values on each concept.

### 3.2 Annotation Interpreters

The global registry `ANNOTATION_INTERPRETERS` maps annotation operators to small functions:

- `HasTag` → creates a `tag` atom;
- `InFolder` → creates a `folder` atom;
- `LinksTo` → creates a `link` atom;
- `HasStatus` → creates a `status` atom;
- `HasType` → creates a `type` atom;
- `AliasFor` → creates an `alias` atom;
- `Fact` → creates a `fact` atom of the form `predicate:subject->object`.

`interpret_annotations` runs all interpreters for a concept and produces its **base feature set**.

### 3.3 Temporal Features and G‑Trace

Temporal metadata (`created`, `updated`) is turned into atoms:

- `created:YYYY-MM-DD`, `created_year:YYYY`,
- `updated:YYYY-MM-DD`, `updated_year:YYYY`.

The `G_trace` operation enriches any feature set with these temporal atoms, providing a minimal approximation to the comonadic trace from the theory.

---

## 4. Modal Closure, Fragments, and Semantics

### 4.1 j‑Closure as Graph Reachability

The modal operator `j` is implemented as a graph closure on atoms:

- `j_relations` is a directed graph whose nodes are atoms;
- `j_closure` takes a feature set and returns all atoms reachable via this graph;
- this satisfies the usual closure properties (extensive, monotone, idempotent) in the finite setting.

Configuration (see §6) determines many of these relations (folder→tag, tag synonyms, type/status→tag).

### 4.2 Fragments via j∘G Fixed Point

For each concept:

1. Start from its **base features** (from annotations).
2. Apply `G_trace` to add temporal atoms.
3. Apply `j_closure` to propagate along the graph.
4. Iterate until a fixed point is reached.

This fixed point is the concept’s **fragment**: the least j,G‑closed feature set containing the seed.

### 4.3 Semantic Contribution

The **semantic feature set** of a concept is built by one more iteration of the same closure process starting from its fragment. This provides a slight “semantic halo” around the fragment, in line with the theoretical notion of semantic contribution.

### 4.4 Evaluation

Each concept receives a simple **evaluation score** based on its semantic features:

- +1 for each `tag` atom,
- +0.5 for each `link` atom,
- +0.3 for each `fact` atom,
- +0.1 for each temporal year atom (`created_year`, `updated_year`).

This is a deliberately simple monoid‑like score; in the future it can be replaced by more sophisticated stewardship‑informed metrics.

---

## 5. Indices and Relatedness

### 5.1 Indices

Once all concepts have semantic features, the publisher builds indices:

- **Tag index**: `tag → {concept IDs}`,
- **Folder index**: `folder → {concept IDs}`,
- **Type index**: `type → {concept IDs}`,
- **Status index**: `status → {concept IDs}`.

These indices support:

- the HTML index page (displaying tag and folder counts, top tags, top concepts), and
- the JSON API and RDF exports (structured access to the same information).

### 5.2 Related Concepts

Relatedness between concepts uses **Jaccard similarity** over semantic feature sets:

$$
  \mathrm{rel}(k, k') =
  \frac{|Sem(k) \cap Sem(k')|}
       {|Sem(k) \cup Sem(k')|}.
$$

For each concept, the publisher:

- computes related concepts with positive similarity,
- sorts them by decreasing similarity,
- keeps the top few, and
- displays them on the HTML concept page as a “related concepts” mini‑index.

---

## 6. Configuration

Configuration is loaded from a YAML file (e.g. `semiotic.config.yml`) into `Config`. Key fields:

- **Identity and routing**
  - `base_url`: base URL for API and RDF URIs;
  - `site_title`: title displayed in the HTML site header.

- **Vault and output**
  - `vault_dir`: path to the Markdown vault;
  - `output_dir`: where generated files are written.

- **Mode and targets**
  - `mode`: `"site"` or `"doc"`;
  - `targets`: list of enabled exporters (`html`, `json`, `rdf`, `openapi`, `pandoc`).

- **Pandoc**
  - `pandoc_enabled`: gate for Pandoc exports;
  - `pandoc_formats`: e.g. `["pdf", "epub"]`;
  - `pandoc_template`: optional Pandoc template;
  - `pandoc_filters`: list of Pandoc filters;
  - `pandoc_output_single`: override output filename for single‑concept export;
  - `pandoc_book_title`: title for combined documents.

- **Vault filtering and semantic rules**
  - `ignore`: glob patterns for files to skip;
  - `folder_tag_rules`: map `folder → tag`, used to configure j‑relations;
  - `tag_synonyms`: symmetric tag synonym relations;
  - `type_tag_rules`: map `type → tag`;
  - `status_tag_rules`: map `status → tag`.

These rules are applied when configuring `j_relations` and therefore affect fragments, semantics, evaluation, and indices.

---

## 7. CLI Usage

The publisher exposes a small CLI with subcommands. The primary entrypoint is:

```bash
python -m src.cli publish [VAULT_DIR] [OUTPUT_DIR] [options]
```

### 7.1 Commands

- `publish`: main command (also aliased as `build`).

### 7.2 Arguments and Options

- `vault_dir` (positional, optional):
  path to the Markdown vault. If omitted, the config’s `vault_dir` is used.

- `output_dir` (positional, optional):
  output directory. If omitted, the config’s `output_dir` is used.

- `--config PATH`:
  path to the YAML config file (e.g. `semiotic.config.yml`).

- `--dry-run`:
  run the full pipeline but do not write any files.

- `--targets "html,json,rdf,openapi,pandoc"`:
  override the list of export targets for this run.

- `--mode site|doc`:
  override `mode` from the config (`site` = static site & APIs, `doc` = Pandoc‑focused).

- `--allow-pandoc`:
  allow invoking Pandoc for `pandoc` targets (otherwise the publisher will print a message and skip).

- `--concept ID`:
  when using `pandoc` targets, restrict export to a single concept ID.

### 7.3 Example Invocations

**Build a full site and APIs using config defaults:**

```bash
python -m src.cli publish --config semiotic.config.yml
```

**Build only HTML and JSON to a specific directory:**

```bash
python -m src.cli publish ./vault ./public \
  --targets html,json \
  --config semiotic.config.yml
```

**Produce a single‑concept PDF via Pandoc:**

```bash
python -m src.cli publish ./vault ./pub \
  --mode doc \
  --targets pandoc \
  --allow-pandoc \
  --concept some-concept-id \
  --config semiotic.config.yml
```

---

## 8. Exported Targets

### 8.1 HTML Site

When `html` is in `targets`, the publisher writes:

- `site/index.html`:
  overview metrics, top tags, top concepts, concept list, tag list.

- `site/concepts/<id>.html`:
  one page per concept, with:
  - title and evaluation meter,
  - metadata and tags in a left margin column,
  - rendered Markdown body,
  - related concepts based on Jaccard similarity.

Templates are small Jinja2 strings embedded in the script; CSS is inline for fully static, self‑contained pages.

### 8.2 JSON API

When `json` is in `targets`, the publisher writes:

- `api/concepts/index.json`:
  summary information for all concepts.

- `api/concepts/<id>.json`:
  detailed information for each concept, including fragment and semantic features rendered as atom lists.

These JSON payloads can serve lightweight clients or be used for downstream processing.

### 8.3 RDF

When `rdf` is in `targets`, the publisher writes an RDF graph (typically `api/graph.ttl` or similar) encoding:

- concepts as RDF resources,
- atoms as resources or literals,
- relations induced by semantic features (tags, folders, links, facts, temporal markers).

The exact vocabulary is simple and pragmatic, aimed at making the semiotic universe queryable with SPARQL.

### 8.4 OpenAPI

When `openapi` is in `targets`, the publisher emits:

- `api/openapi.json`: an OpenAPI 3 specification describing the JSON API.

This makes it easy to generate clients or explore the API using standard tools.

### 8.5 Pandoc

When `pandoc` is in `targets` and `pandoc_enabled` is true:

- Each selected concept (or a combined set of concepts) is converted to Markdown with:
  - YAML frontmatter capturing key metadata,
  - the concept body,
  - an optional appendix listing semantic features.

The publisher then invokes `pandoc` with configured formats, templates, and filters to produce documents such as PDF or EPUB.

---

## 9. Extending the Publisher

Some common extension points:

- **New annotation operators**:
  add a new `@register_annotation("OpName")` function mapping frontmatter or structural patterns to atoms.

- **New j‑relations**:
  extend `folder_tag_rules`, `tag_synonyms`, `type_tag_rules`, or `status_tag_rules` in the config to change how fragment closure behaves.

- **Alternative evaluation metrics**:
  modify `evaluate_concept` to incorporate new signals (e.g. length of body, stewardship status, or user‑provided weights).

- **Additional exporters**:
  add new `export_*` functions and register them in `export_all` and `targets` handling.

These extensions stay within the same finite‐feature and closure framework, preserving alignment with the underlying theoretical universe.

---

## 10. Relationship to the Theoretical Docs

- `semiotic-universe.md` describes the **idealized**, infinite Heyting–modal–comonadic universe and its fusion mechanism.
- `stewardable-semiotic-concept-universe.md` describes a stewardship‑oriented extension with failure semantics, deltas, and sheaf‑like behavior.
- **This document** explains the **concrete publisher implementation** that:
  - approximates the universe using finite atoms and graph closure,
  - treats concepts as vault documents,
  - and exports multiple static views (site, API, RDF, documents) suitable for stewardship and analysis.

In short, the Semiotic Publisher is the bridge between **vault practice** and **semiotic theory**: it turns annotated Markdown into a working, inspectable instance of the semiotic universe.
