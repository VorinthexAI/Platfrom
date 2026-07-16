# Reverse Context Compiler
## Part 1 — Foundation

## Purpose
The Reverse Context Compiler converts persisted database objects into optimized runtime knowledge for AI agents.

Pipeline:

Database
→ Embeddings
→ Vector Search
→ Top N Nodes
→ Reverse Context Compiler
→ Knowledge Pack
→ AgentContext
→ LLM

## Core Principles

- Never inject raw database rows.
- Never inject unnecessary metadata.
- Use `embeddingFields` as the single source of truth.
- Runtime owns context construction.
- LLM owns reasoning only.

## Forward Pipeline

Node
→ embeddingFields
→ Extract values
→ Embedding Model
→ embedding[]

## Reverse Pipeline

Query
→ Query Embedding
→ Vector Search
→ Top Results
→ Read embeddingFields
→ Extract values
→ Normalize
→ Knowledge Blocks
→ Knowledge Pack
→ AgentContext

## embeddingFields

Examples

BlogPost
- title
- summary
- content

Skill
- name
- title
- definition

Agent
- name
- title

## Knowledge Block

Every resolver returns:

- nodeType
- nodeKey
- title
- summary
- content
- metadata

No database object is exposed to the LLM.

## Runtime Responsibilities

Runtime owns:
- repositories
- graph traversal
- vector search
- permissions
- normalization
- compression
- context budget
- AgentContext

LLM owns:
- reasoning
- planning
- generation



# Reverse Context Compiler
## Part 2 — Runtime

## Universal Resolver

Every searchable node implements:

- exists()
- load()
- findSimilar()
- extractContext()

## Generic Algorithm

Current Task
→ Embedding
→ Vector Search
→ Top 20
→ Permission Filter
→ Resolver
→ extractContext()
→ Knowledge Blocks
→ Rank
→ Compress
→ Knowledge Pack
→ AgentContext

## Ranking

Score =
- similarity
- manual priority
- freshness

Manual sources always rank above automatic search.

## Compression Order

1. Deduplicate
2. Trim
3. Summarize
4. Drop

## Context Budget

Runtime owns the token budget.

If budget exceeded:
- remove duplicates
- compress
- drop lowest ranked blocks

## Lazy Loading

Knowledge Blocks contain references only.

If the agent needs the full object:

Knowledge Block
→ Artifact Read Tool
→ Resolver
→ Full Object

Never inject complete repositories by default.

## Security

Resolvers verify:
- organization
- scope
- permissions

before returning context.
# Reverse Context Compiler
## Part 3 — Implementation

## Required Components

- Resolver Registry
- Reverse Context Compiler
- Knowledge Pack Builder
- Ranking Engine
- Compression Engine
- Budget Manager
- Artifact Read Tool

## Required Node Contract

Every searchable node contains:

- key
- organizationKey
- scopeKey
- embedding
- embeddingFields

## Runtime Flow

Current Task
→ Query Embedding
→ Vector Search
→ Top N
→ Resolver
→ Knowledge Blocks
→ Ranking
→ Compression
→ Knowledge Pack
→ AgentContext
→ LLM

## Deliverables

Implement:

- NodeResolver interface
- KnowledgeBlock interface
- KnowledgePack builder
- Resolver Registry
- Reverse Context Compiler
- Unit Tests
- Integration Tests

## Golden Rule

Storage
↓

Knowledge
↓

Reasoning

Database objects never reach the LLM directly.
