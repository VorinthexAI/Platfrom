# Vorinthex AgentContext + Artifact Runtime Architecture

## Purpose

This document specifies the runtime context, artifact system, source injection,
novelty detection, and execution flow for Vorinthex agents.

---

# Core Philosophy

The database stores facts.

Runtime compiles context.

Agents never query databases directly.

Agents only receive an AgentContext.

---

# AgentContext

AgentContext
├── organization
├── scope
├── agent
├── skills
├── tools
├── variables
├── memories
├── artifacts
├── permissions
├── guardrails
├── sourcePolicy
└── currentTask

Every execution compiles a fresh AgentContext.

---

# Runtime Compilation

User Request
↓
Load Organization
↓
Load Scope
↓
Load Agent
↓
Load Agent Skills
↓
Sort Skills by priority
↓
Load Skill definitions
↓
Load Agent Tools
↓
Load Runtime Variables
↓
Load Memories
↓
Load Artifact Sources
↓
Resolve Permissions
↓
Build Guardrails
↓
Resolve Exploration Strategy
↓
Compile AgentContext
↓
Execute

---

# Artifact Philosophy

Artifacts are persistent business objects.

Examples

blogPosts
images
videos
hooks
captions
hashtags
documents
reports
slideshows
posts
emails

There is NO generic artifacts collection.

Every artifact lives in its own domain collection.

---

# agentArtifacts

Purpose

Track which artifacts a run created or used.

Schema

key
agentRunKey
nodeType
nodeKey
relation
groupKey
position

Relations

source
result
attachment
intermediate

---

# agentRunSources

Purpose

Explicit source selection for one execution.

Schema

key
agentRunKey
nodeType
nodeKey
priority

Any node may become a source.

Examples

blog-post
image
video
document
slideshow
report

---

# Exploration Strategy

Agent configuration only stores

explorationRate

0.0
100% exploit

0.5
Balanced

1.0
100% explore

No selfSustaining flag exists.

Runtime derives the effective strategy.

Rule:

If no sources exist then exploit is impossible.

Therefore

effectiveExplorationRate = 1.0

even if

requestedExplorationRate = 0.

Runtime exposes

requestedExplorationRate
effectiveExplorationRate
sourceCount

inside AgentContext.

---

# Source Resolution

AgentRunSources
↓
Validate organization
↓
Validate permissions
↓
Resolve node
↓
Create compact artifact references
↓
Inject into AgentContext.artifacts

Do not inject complete documents by default.

Inject references:

nodeType
nodeKey
name
summary

Use tools to retrieve full content when needed.

---

# Artifact Resolver Registry

Each nodeType has a resolver.

Examples

blog-post
→ blogPosts repository

image
→ images repository

video
→ videos repository

slideshow
→ slideshows repository

Resolvers provide

exists()

getReference()

getContent()

findSimilar()

---

# Novelty Detection

Every persisted node already contains

embedding: number[]

This is the universal duplicate check.

Flow

Candidate artifact
↓
Generate embedding
↓
Vector search
↓
Top similar artifacts
↓
Similarity policy
↓
Optional validator
↓
Persist artifact

---

# agentArtifactChecks

Purpose

Track duplicate and novelty decisions.

Schema

key
agentRunKey
candidateNodeType
candidateNodeKey
comparedNodeType
comparedNodeKey
similarity
decision
reason
createdAt

Decisions

accepted
revised
rejected

---

# Similarity Policy

Each node type defines thresholds.

Example

hook

reviewThreshold
0.80

rejectThreshold
0.90

image

reviewThreshold
0.88

rejectThreshold
0.96

blog-post

reviewThreshold
0.82

rejectThreshold
0.94

---

# Content Pipeline Example

Research Agent
→ research reports

Blog Agent
sources:
research reports

results:
blog posts

Content Agent
sources:
blog posts
brand guides
templates

results:
hooks
captions
hashtags
voice
audio
images
slideshows

Publishing Agent
sources:
slideshows
captions
hashtags

results:
scheduled posts

Everything is linked through agentArtifacts.

---

# Design Principles

- Runtime owns context.
- Agents never query storage.
- Sources are explicit.
- Exploration is derived.
- Artifacts are domain objects.
- agentArtifacts tracks provenance.
- agentRunSources tracks inputs.
- agentArtifactChecks tracks novelty.
- Memories store reusable knowledge only.
- Embeddings are universal similarity vectors.
