# Website Intelligence Standard

The agent must create a reusable Website Intelligence system.

Do NOT assume that pages have:

- blog posts
- documentation
- changelog
- FAQ
- pricing
- API docs

Those may be introduced later.

Instead, build the infrastructure so they automatically become supported when those routes exist.

---

## Every public page MUST support

- robots.txt
- sitemap.xml
- llms.txt
- security.txt
- humans.txt
- rss.xml (only if content exists)
- feed.json (only if content exists)
- manifest.webmanifest
- favicon set
- OpenGraph
- Twitter Cards
- canonical
- JSON-LD
- basic metadata

---

## RSS

RSS should NOT assume blog posts.

Instead:

If RSS content exists

↓

Generate rss.xml.

Otherwise

↓

Do not generate one.

---

## JSON Feed

Same behavior.

Generate only if supported.

---

## Structured Data

Generate only the schema that is appropriate.

For example

Home page

↓

Organization

Product page

↓

SoftwareApplication

Capability page

↓

SoftwareApplication

Command Orchestrator

↓

Service

Do NOT generate schemas that do not make sense.

---

## OpenGraph

Every page must have

- unique title
- unique description
- unique image

Use the matching logo automatically.

Product

↓

Product logo

Capability

↓

Capability logo

Command

↓

Command logo

---

## Twitter Cards

Same behavior.

Automatically generated.

Unique.

---

## Manifest

Every website should expose

manifest.webmanifest

using shared defaults.

---

## Favicons

Generate

favicon.ico

favicon.svg

favicon-16

favicon-32

apple-touch-icon

android icons

Automatically.

---

## robots.txt

Automatically generated.

Environment aware.

Development

↓

Disallow all.

Production

↓

Allow all.

---

## llms.txt

Automatically generated.

Read Galaxy Registry.

Read SEO metadata.

Read AEO summaries.

Never duplicate content manually.

---

## security.txt

Automatically generated.

Shared company configuration.

---

## humans.txt

Automatically generated.

Shared company configuration.

---

## Metadata Engine

Everything should inherit defaults.

Only override values that differ.

Never duplicate metadata.

---

## Registry Driven

The Galaxy Registry remains the source of truth.

When a new product, capability or orchestrator is added:

Automatically create

- metadata
- OpenGraph
- Twitter
- robots
- llms
- manifest
- favicon
- security
- humans

without additional implementation.

---

The Website Intelligence framework should be future-proof.

New metadata standards should be introducible by extending the metadata engine rather than modifying every website.