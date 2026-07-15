# Vorinthex Agent Framework Architecture Specification

This document defines the implementation architecture for the Vorinthex Agent Framework.

# Vision


## Vision — Section 1

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Vision — Section 2

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Vision — Section 3

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Vision — Section 4

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Vision — Section 5

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Vision — Section 6

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Vision — Section 7

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Vision — Section 8

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Vision — Section 9

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Vision — Section 10

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Vision — Section 11

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Vision — Section 12

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Vision — Section 13

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Vision — Section 14

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Vision — Section 15

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Vision — Section 16

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Vision — Section 17

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Vision — Section 18

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Vision — Section 19

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Vision — Section 20

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Vision — Section 21

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Vision — Section 22

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Vision — Section 23

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Vision — Section 24

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Vision — Section 25

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Vision — Section 26

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Vision — Section 27

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Vision — Section 28

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Vision — Section 29

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Vision — Section 30

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Vision — Section 31

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Vision — Section 32

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Vision — Section 33

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Vision — Section 34

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Vision — Section 35

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Vision — Section 36

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Vision — Section 37

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Vision — Section 38

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Vision — Section 39

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Vision — Section 40

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.

# Core Principles


## Core Principles — Section 1

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Core Principles — Section 2

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Core Principles — Section 3

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Core Principles — Section 4

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Core Principles — Section 5

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Core Principles — Section 6

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Core Principles — Section 7

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Core Principles — Section 8

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Core Principles — Section 9

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Core Principles — Section 10

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Core Principles — Section 11

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Core Principles — Section 12

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Core Principles — Section 13

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Core Principles — Section 14

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Core Principles — Section 15

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Core Principles — Section 16

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Core Principles — Section 17

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Core Principles — Section 18

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Core Principles — Section 19

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Core Principles — Section 20

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Core Principles — Section 21

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Core Principles — Section 22

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Core Principles — Section 23

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Core Principles — Section 24

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Core Principles — Section 25

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Core Principles — Section 26

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Core Principles — Section 27

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Core Principles — Section 28

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Core Principles — Section 29

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Core Principles — Section 30

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Core Principles — Section 31

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Core Principles — Section 32

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Core Principles — Section 33

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Core Principles — Section 34

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Core Principles — Section 35

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Core Principles — Section 36

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Core Principles — Section 37

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Core Principles — Section 38

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Core Principles — Section 39

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Core Principles — Section 40

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.

# Folder Structure


## Folder Structure — Section 1

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Folder Structure — Section 2

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Folder Structure — Section 3

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Folder Structure — Section 4

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Folder Structure — Section 5

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Folder Structure — Section 6

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Folder Structure — Section 7

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Folder Structure — Section 8

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Folder Structure — Section 9

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Folder Structure — Section 10

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Folder Structure — Section 11

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Folder Structure — Section 12

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Folder Structure — Section 13

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Folder Structure — Section 14

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Folder Structure — Section 15

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Folder Structure — Section 16

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Folder Structure — Section 17

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Folder Structure — Section 18

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Folder Structure — Section 19

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Folder Structure — Section 20

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Folder Structure — Section 21

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Folder Structure — Section 22

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Folder Structure — Section 23

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Folder Structure — Section 24

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Folder Structure — Section 25

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Folder Structure — Section 26

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Folder Structure — Section 27

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Folder Structure — Section 28

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Folder Structure — Section 29

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Folder Structure — Section 30

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Folder Structure — Section 31

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Folder Structure — Section 32

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Folder Structure — Section 33

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Folder Structure — Section 34

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Folder Structure — Section 35

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Folder Structure — Section 36

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Folder Structure — Section 37

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Folder Structure — Section 38

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Folder Structure — Section 39

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Folder Structure — Section 40

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.

# Database


## Database — Section 1

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Database — Section 2

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Database — Section 3

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Database — Section 4

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Database — Section 5

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Database — Section 6

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Database — Section 7

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Database — Section 8

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Database — Section 9

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Database — Section 10

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Database — Section 11

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Database — Section 12

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Database — Section 13

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Database — Section 14

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Database — Section 15

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Database — Section 16

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Database — Section 17

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Database — Section 18

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Database — Section 19

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Database — Section 20

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Database — Section 21

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Database — Section 22

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Database — Section 23

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Database — Section 24

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Database — Section 25

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Database — Section 26

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Database — Section 27

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Database — Section 28

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Database — Section 29

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Database — Section 30

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Database — Section 31

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Database — Section 32

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Database — Section 33

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Database — Section 34

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Database — Section 35

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Database — Section 36

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Database — Section 37

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Database — Section 38

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Database — Section 39

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Database — Section 40

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.

# Organization Scopes


## Organization Scopes — Section 1

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Organization Scopes — Section 2

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Organization Scopes — Section 3

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Organization Scopes — Section 4

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Organization Scopes — Section 5

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Organization Scopes — Section 6

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Organization Scopes — Section 7

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Organization Scopes — Section 8

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Organization Scopes — Section 9

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Organization Scopes — Section 10

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Organization Scopes — Section 11

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Organization Scopes — Section 12

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Organization Scopes — Section 13

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Organization Scopes — Section 14

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Organization Scopes — Section 15

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Organization Scopes — Section 16

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Organization Scopes — Section 17

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Organization Scopes — Section 18

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Organization Scopes — Section 19

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Organization Scopes — Section 20

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Organization Scopes — Section 21

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Organization Scopes — Section 22

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Organization Scopes — Section 23

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Organization Scopes — Section 24

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Organization Scopes — Section 25

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Organization Scopes — Section 26

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Organization Scopes — Section 27

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Organization Scopes — Section 28

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Organization Scopes — Section 29

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Organization Scopes — Section 30

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Organization Scopes — Section 31

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Organization Scopes — Section 32

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Organization Scopes — Section 33

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Organization Scopes — Section 34

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Organization Scopes — Section 35

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Organization Scopes — Section 36

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Organization Scopes — Section 37

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Organization Scopes — Section 38

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Organization Scopes — Section 39

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Organization Scopes — Section 40

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.

# Organization Providers


## Organization Providers — Section 1

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Organization Providers — Section 2

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Organization Providers — Section 3

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Organization Providers — Section 4

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Organization Providers — Section 5

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Organization Providers — Section 6

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Organization Providers — Section 7

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Organization Providers — Section 8

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Organization Providers — Section 9

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Organization Providers — Section 10

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Organization Providers — Section 11

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Organization Providers — Section 12

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Organization Providers — Section 13

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Organization Providers — Section 14

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Organization Providers — Section 15

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Organization Providers — Section 16

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Organization Providers — Section 17

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Organization Providers — Section 18

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Organization Providers — Section 19

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Organization Providers — Section 20

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Organization Providers — Section 21

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Organization Providers — Section 22

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Organization Providers — Section 23

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Organization Providers — Section 24

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Organization Providers — Section 25

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Organization Providers — Section 26

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Organization Providers — Section 27

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Organization Providers — Section 28

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Organization Providers — Section 29

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Organization Providers — Section 30

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Organization Providers — Section 31

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Organization Providers — Section 32

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Organization Providers — Section 33

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Organization Providers — Section 34

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Organization Providers — Section 35

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Organization Providers — Section 36

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Organization Providers — Section 37

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Organization Providers — Section 38

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Organization Providers — Section 39

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Organization Providers — Section 40

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.

# Actions Registry


## Actions Registry — Section 1

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Actions Registry — Section 2

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Actions Registry — Section 3

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Actions Registry — Section 4

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Actions Registry — Section 5

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Actions Registry — Section 6

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Actions Registry — Section 7

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Actions Registry — Section 8

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Actions Registry — Section 9

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Actions Registry — Section 10

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Actions Registry — Section 11

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Actions Registry — Section 12

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Actions Registry — Section 13

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Actions Registry — Section 14

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Actions Registry — Section 15

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Actions Registry — Section 16

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Actions Registry — Section 17

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Actions Registry — Section 18

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Actions Registry — Section 19

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Actions Registry — Section 20

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Actions Registry — Section 21

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Actions Registry — Section 22

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Actions Registry — Section 23

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Actions Registry — Section 24

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Actions Registry — Section 25

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Actions Registry — Section 26

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Actions Registry — Section 27

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Actions Registry — Section 28

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Actions Registry — Section 29

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Actions Registry — Section 30

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Actions Registry — Section 31

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Actions Registry — Section 32

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Actions Registry — Section 33

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Actions Registry — Section 34

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Actions Registry — Section 35

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Actions Registry — Section 36

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Actions Registry — Section 37

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Actions Registry — Section 38

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Actions Registry — Section 39

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Actions Registry — Section 40

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.

# Providers Registry


## Providers Registry — Section 1

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Providers Registry — Section 2

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Providers Registry — Section 3

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Providers Registry — Section 4

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Providers Registry — Section 5

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Providers Registry — Section 6

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Providers Registry — Section 7

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Providers Registry — Section 8

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Providers Registry — Section 9

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Providers Registry — Section 10

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Providers Registry — Section 11

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Providers Registry — Section 12

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Providers Registry — Section 13

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Providers Registry — Section 14

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Providers Registry — Section 15

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Providers Registry — Section 16

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Providers Registry — Section 17

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Providers Registry — Section 18

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Providers Registry — Section 19

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Providers Registry — Section 20

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Providers Registry — Section 21

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Providers Registry — Section 22

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Providers Registry — Section 23

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Providers Registry — Section 24

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Providers Registry — Section 25

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Providers Registry — Section 26

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Providers Registry — Section 27

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Providers Registry — Section 28

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Providers Registry — Section 29

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Providers Registry — Section 30

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Providers Registry — Section 31

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Providers Registry — Section 32

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Providers Registry — Section 33

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Providers Registry — Section 34

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Providers Registry — Section 35

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Providers Registry — Section 36

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Providers Registry — Section 37

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Providers Registry — Section 38

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Providers Registry — Section 39

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Providers Registry — Section 40

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.

# Models Registry


## Models Registry — Section 1

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Models Registry — Section 2

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Models Registry — Section 3

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Models Registry — Section 4

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Models Registry — Section 5

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Models Registry — Section 6

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Models Registry — Section 7

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Models Registry — Section 8

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Models Registry — Section 9

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Models Registry — Section 10

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Models Registry — Section 11

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Models Registry — Section 12

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Models Registry — Section 13

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Models Registry — Section 14

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Models Registry — Section 15

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Models Registry — Section 16

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Models Registry — Section 17

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Models Registry — Section 18

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Models Registry — Section 19

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Models Registry — Section 20

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Models Registry — Section 21

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Models Registry — Section 22

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Models Registry — Section 23

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Models Registry — Section 24

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Models Registry — Section 25

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Models Registry — Section 26

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Models Registry — Section 27

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Models Registry — Section 28

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Models Registry — Section 29

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Models Registry — Section 30

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Models Registry — Section 31

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Models Registry — Section 32

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Models Registry — Section 33

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Models Registry — Section 34

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Models Registry — Section 35

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Models Registry — Section 36

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Models Registry — Section 37

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Models Registry — Section 38

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Models Registry — Section 39

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Models Registry — Section 40

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.

# Router


## Router — Section 1

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Router — Section 2

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Router — Section 3

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Router — Section 4

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Router — Section 5

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Router — Section 6

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Router — Section 7

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Router — Section 8

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Router — Section 9

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Router — Section 10

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Router — Section 11

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Router — Section 12

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Router — Section 13

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Router — Section 14

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Router — Section 15

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Router — Section 16

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Router — Section 17

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Router — Section 18

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Router — Section 19

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Router — Section 20

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Router — Section 21

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Router — Section 22

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Router — Section 23

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Router — Section 24

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Router — Section 25

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Router — Section 26

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Router — Section 27

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Router — Section 28

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Router — Section 29

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Router — Section 30

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Router — Section 31

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Router — Section 32

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Router — Section 33

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Router — Section 34

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Router — Section 35

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Router — Section 36

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Router — Section 37

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Router — Section 38

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Router — Section 39

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Router — Section 40

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.

# Tools Registry


## Tools Registry — Section 1

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Tools Registry — Section 2

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Tools Registry — Section 3

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Tools Registry — Section 4

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Tools Registry — Section 5

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Tools Registry — Section 6

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Tools Registry — Section 7

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Tools Registry — Section 8

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Tools Registry — Section 9

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Tools Registry — Section 10

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Tools Registry — Section 11

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Tools Registry — Section 12

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Tools Registry — Section 13

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Tools Registry — Section 14

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Tools Registry — Section 15

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Tools Registry — Section 16

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Tools Registry — Section 17

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Tools Registry — Section 18

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Tools Registry — Section 19

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Tools Registry — Section 20

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Tools Registry — Section 21

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Tools Registry — Section 22

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Tools Registry — Section 23

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Tools Registry — Section 24

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Tools Registry — Section 25

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Tools Registry — Section 26

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Tools Registry — Section 27

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Tools Registry — Section 28

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Tools Registry — Section 29

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Tools Registry — Section 30

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Tools Registry — Section 31

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Tools Registry — Section 32

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Tools Registry — Section 33

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Tools Registry — Section 34

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Tools Registry — Section 35

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Tools Registry — Section 36

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Tools Registry — Section 37

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Tools Registry — Section 38

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Tools Registry — Section 39

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Tools Registry — Section 40

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.

# Agents


## Agents — Section 1

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Agents — Section 2

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Agents — Section 3

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Agents — Section 4

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Agents — Section 5

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Agents — Section 6

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Agents — Section 7

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Agents — Section 8

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Agents — Section 9

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Agents — Section 10

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Agents — Section 11

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Agents — Section 12

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Agents — Section 13

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Agents — Section 14

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Agents — Section 15

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Agents — Section 16

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Agents — Section 17

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Agents — Section 18

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Agents — Section 19

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Agents — Section 20

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Agents — Section 21

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Agents — Section 22

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Agents — Section 23

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Agents — Section 24

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Agents — Section 25

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Agents — Section 26

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Agents — Section 27

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Agents — Section 28

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Agents — Section 29

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Agents — Section 30

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Agents — Section 31

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Agents — Section 32

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Agents — Section 33

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Agents — Section 34

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Agents — Section 35

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Agents — Section 36

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Agents — Section 37

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Agents — Section 38

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Agents — Section 39

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Agents — Section 40

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.

# Guardrails


## Guardrails — Section 1

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Guardrails — Section 2

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Guardrails — Section 3

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Guardrails — Section 4

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Guardrails — Section 5

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Guardrails — Section 6

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Guardrails — Section 7

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Guardrails — Section 8

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Guardrails — Section 9

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Guardrails — Section 10

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Guardrails — Section 11

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Guardrails — Section 12

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Guardrails — Section 13

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Guardrails — Section 14

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Guardrails — Section 15

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Guardrails — Section 16

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Guardrails — Section 17

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Guardrails — Section 18

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Guardrails — Section 19

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Guardrails — Section 20

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Guardrails — Section 21

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Guardrails — Section 22

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Guardrails — Section 23

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Guardrails — Section 24

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Guardrails — Section 25

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Guardrails — Section 26

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Guardrails — Section 27

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Guardrails — Section 28

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Guardrails — Section 29

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Guardrails — Section 30

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Guardrails — Section 31

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Guardrails — Section 32

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Guardrails — Section 33

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Guardrails — Section 34

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Guardrails — Section 35

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Guardrails — Section 36

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Guardrails — Section 37

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Guardrails — Section 38

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Guardrails — Section 39

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Guardrails — Section 40

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.

# SKILL.md


## SKILL.md — Section 1

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## SKILL.md — Section 2

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## SKILL.md — Section 3

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## SKILL.md — Section 4

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## SKILL.md — Section 5

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## SKILL.md — Section 6

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## SKILL.md — Section 7

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## SKILL.md — Section 8

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## SKILL.md — Section 9

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## SKILL.md — Section 10

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## SKILL.md — Section 11

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## SKILL.md — Section 12

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## SKILL.md — Section 13

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## SKILL.md — Section 14

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## SKILL.md — Section 15

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## SKILL.md — Section 16

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## SKILL.md — Section 17

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## SKILL.md — Section 18

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## SKILL.md — Section 19

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## SKILL.md — Section 20

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## SKILL.md — Section 21

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## SKILL.md — Section 22

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## SKILL.md — Section 23

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## SKILL.md — Section 24

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## SKILL.md — Section 25

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## SKILL.md — Section 26

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## SKILL.md — Section 27

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## SKILL.md — Section 28

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## SKILL.md — Section 29

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## SKILL.md — Section 30

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## SKILL.md — Section 31

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## SKILL.md — Section 32

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## SKILL.md — Section 33

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## SKILL.md — Section 34

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## SKILL.md — Section 35

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## SKILL.md — Section 36

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## SKILL.md — Section 37

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## SKILL.md — Section 38

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## SKILL.md — Section 39

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## SKILL.md — Section 40

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.

# schema.ts


## schema.ts — Section 1

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## schema.ts — Section 2

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## schema.ts — Section 3

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## schema.ts — Section 4

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## schema.ts — Section 5

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## schema.ts — Section 6

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## schema.ts — Section 7

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## schema.ts — Section 8

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## schema.ts — Section 9

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## schema.ts — Section 10

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## schema.ts — Section 11

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## schema.ts — Section 12

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## schema.ts — Section 13

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## schema.ts — Section 14

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## schema.ts — Section 15

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## schema.ts — Section 16

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## schema.ts — Section 17

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## schema.ts — Section 18

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## schema.ts — Section 19

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## schema.ts — Section 20

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## schema.ts — Section 21

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## schema.ts — Section 22

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## schema.ts — Section 23

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## schema.ts — Section 24

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## schema.ts — Section 25

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## schema.ts — Section 26

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## schema.ts — Section 27

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## schema.ts — Section 28

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## schema.ts — Section 29

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## schema.ts — Section 30

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## schema.ts — Section 31

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## schema.ts — Section 32

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## schema.ts — Section 33

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## schema.ts — Section 34

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## schema.ts — Section 35

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## schema.ts — Section 36

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## schema.ts — Section 37

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## schema.ts — Section 38

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## schema.ts — Section 39

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## schema.ts — Section 40

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.

# agent_runs


## agent_runs — Section 1

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## agent_runs — Section 2

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## agent_runs — Section 3

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## agent_runs — Section 4

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## agent_runs — Section 5

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## agent_runs — Section 6

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## agent_runs — Section 7

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## agent_runs — Section 8

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## agent_runs — Section 9

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## agent_runs — Section 10

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## agent_runs — Section 11

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## agent_runs — Section 12

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## agent_runs — Section 13

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## agent_runs — Section 14

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## agent_runs — Section 15

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## agent_runs — Section 16

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## agent_runs — Section 17

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## agent_runs — Section 18

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## agent_runs — Section 19

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## agent_runs — Section 20

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## agent_runs — Section 21

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## agent_runs — Section 22

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## agent_runs — Section 23

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## agent_runs — Section 24

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## agent_runs — Section 25

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## agent_runs — Section 26

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## agent_runs — Section 27

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## agent_runs — Section 28

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## agent_runs — Section 29

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## agent_runs — Section 30

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## agent_runs — Section 31

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## agent_runs — Section 32

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## agent_runs — Section 33

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## agent_runs — Section 34

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## agent_runs — Section 35

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## agent_runs — Section 36

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## agent_runs — Section 37

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## agent_runs — Section 38

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## agent_runs — Section 39

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## agent_runs — Section 40

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.

# Prompt Compilation


## Prompt Compilation — Section 1

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Prompt Compilation — Section 2

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Prompt Compilation — Section 3

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Prompt Compilation — Section 4

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Prompt Compilation — Section 5

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Prompt Compilation — Section 6

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Prompt Compilation — Section 7

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Prompt Compilation — Section 8

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Prompt Compilation — Section 9

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Prompt Compilation — Section 10

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Prompt Compilation — Section 11

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Prompt Compilation — Section 12

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Prompt Compilation — Section 13

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Prompt Compilation — Section 14

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Prompt Compilation — Section 15

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Prompt Compilation — Section 16

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Prompt Compilation — Section 17

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Prompt Compilation — Section 18

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Prompt Compilation — Section 19

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Prompt Compilation — Section 20

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Prompt Compilation — Section 21

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Prompt Compilation — Section 22

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Prompt Compilation — Section 23

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Prompt Compilation — Section 24

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Prompt Compilation — Section 25

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Prompt Compilation — Section 26

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Prompt Compilation — Section 27

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Prompt Compilation — Section 28

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Prompt Compilation — Section 29

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Prompt Compilation — Section 30

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Prompt Compilation — Section 31

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Prompt Compilation — Section 32

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Prompt Compilation — Section 33

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Prompt Compilation — Section 34

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Prompt Compilation — Section 35

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Prompt Compilation — Section 36

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Prompt Compilation — Section 37

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Prompt Compilation — Section 38

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Prompt Compilation — Section 39

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Prompt Compilation — Section 40

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.

# Execution Pipeline


## Execution Pipeline — Section 1

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Execution Pipeline — Section 2

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Execution Pipeline — Section 3

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Execution Pipeline — Section 4

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Execution Pipeline — Section 5

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Execution Pipeline — Section 6

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Execution Pipeline — Section 7

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Execution Pipeline — Section 8

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Execution Pipeline — Section 9

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Execution Pipeline — Section 10

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Execution Pipeline — Section 11

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Execution Pipeline — Section 12

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Execution Pipeline — Section 13

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Execution Pipeline — Section 14

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Execution Pipeline — Section 15

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Execution Pipeline — Section 16

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Execution Pipeline — Section 17

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Execution Pipeline — Section 18

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Execution Pipeline — Section 19

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Execution Pipeline — Section 20

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Execution Pipeline — Section 21

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Execution Pipeline — Section 22

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Execution Pipeline — Section 23

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Execution Pipeline — Section 24

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Execution Pipeline — Section 25

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Execution Pipeline — Section 26

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Execution Pipeline — Section 27

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Execution Pipeline — Section 28

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Execution Pipeline — Section 29

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Execution Pipeline — Section 30

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Execution Pipeline — Section 31

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Execution Pipeline — Section 32

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Execution Pipeline — Section 33

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Execution Pipeline — Section 34

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Execution Pipeline — Section 35

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Execution Pipeline — Section 36

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Execution Pipeline — Section 37

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Execution Pipeline — Section 38

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Execution Pipeline — Section 39

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Execution Pipeline — Section 40

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.

# Validation


## Validation — Section 1

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Validation — Section 2

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Validation — Section 3

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Validation — Section 4

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Validation — Section 5

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Validation — Section 6

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Validation — Section 7

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Validation — Section 8

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Validation — Section 9

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Validation — Section 10

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Validation — Section 11

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Validation — Section 12

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Validation — Section 13

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Validation — Section 14

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Validation — Section 15

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Validation — Section 16

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Validation — Section 17

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Validation — Section 18

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Validation — Section 19

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Validation — Section 20

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Validation — Section 21

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Validation — Section 22

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Validation — Section 23

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Validation — Section 24

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Validation — Section 25

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Validation — Section 26

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Validation — Section 27

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Validation — Section 28

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Validation — Section 29

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Validation — Section 30

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Validation — Section 31

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Validation — Section 32

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Validation — Section 33

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Validation — Section 34

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Validation — Section 35

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Validation — Section 36

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Validation — Section 37

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Validation — Section 38

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Validation — Section 39

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Validation — Section 40

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.

# Testing


## Testing — Section 1

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Testing — Section 2

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Testing — Section 3

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Testing — Section 4

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Testing — Section 5

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Testing — Section 6

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Testing — Section 7

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Testing — Section 8

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Testing — Section 9

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Testing — Section 10

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Testing — Section 11

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Testing — Section 12

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Testing — Section 13

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Testing — Section 14

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Testing — Section 15

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Testing — Section 16

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Testing — Section 17

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Testing — Section 18

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Testing — Section 19

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Testing — Section 20

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Testing — Section 21

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Testing — Section 22

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Testing — Section 23

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Testing — Section 24

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Testing — Section 25

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Testing — Section 26

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Testing — Section 27

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Testing — Section 28

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Testing — Section 29

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Testing — Section 30

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Testing — Section 31

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Testing — Section 32

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Testing — Section 33

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Testing — Section 34

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Testing — Section 35

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Testing — Section 36

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Testing — Section 37

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Testing — Section 38

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Testing — Section 39

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Testing — Section 40

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.

# Implementation Roadmap


## Implementation Roadmap — Section 1

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Implementation Roadmap — Section 2

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Implementation Roadmap — Section 3

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Implementation Roadmap — Section 4

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Implementation Roadmap — Section 5

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Implementation Roadmap — Section 6

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Implementation Roadmap — Section 7

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Implementation Roadmap — Section 8

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Implementation Roadmap — Section 9

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Implementation Roadmap — Section 10

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Implementation Roadmap — Section 11

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Implementation Roadmap — Section 12

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Implementation Roadmap — Section 13

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Implementation Roadmap — Section 14

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Implementation Roadmap — Section 15

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Implementation Roadmap — Section 16

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Implementation Roadmap — Section 17

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Implementation Roadmap — Section 18

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Implementation Roadmap — Section 19

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Implementation Roadmap — Section 20

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Implementation Roadmap — Section 21

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Implementation Roadmap — Section 22

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Implementation Roadmap — Section 23

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Implementation Roadmap — Section 24

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Implementation Roadmap — Section 25

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Implementation Roadmap — Section 26

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Implementation Roadmap — Section 27

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Implementation Roadmap — Section 28

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Implementation Roadmap — Section 29

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Implementation Roadmap — Section 30

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Implementation Roadmap — Section 31

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Implementation Roadmap — Section 32

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Implementation Roadmap — Section 33

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Implementation Roadmap — Section 34

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Implementation Roadmap — Section 35

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Implementation Roadmap — Section 36

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Implementation Roadmap — Section 37

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Implementation Roadmap — Section 38

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Implementation Roadmap — Section 39

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.


## Implementation Roadmap — Section 40

Requirements:
- Use TypeScript strict mode.
- Use Zod for runtime validation.
- Keep modules isolated.
- Export public APIs from index.ts.
- Avoid circular dependencies.
- Prefer composition over inheritance.
- Preserve a single source of truth.
- Follow repository conventions where applicable.

Architecture reminder:

Agent
-> Tool
-> Action
-> Router
-> Model
-> Provider
-> Response
-> Validation
-> agent_runs

Organization scopes:
Create an `organization_scopes` node with:
- _key (CUID)
- name

Guardrails contain only:
- scopeId

organization_providers:
- one document per enabled provider
- unique (organizationId, providerId)

Actions use ACTION_IDS with <domain>.<action> notation.

Providers:
OpenAI, Anthropic, xAI, Google Vertex AI, Azure AI Foundry,
AWS Bedrock and OpenRouter.

Router must only select provider routes enabled through organization_providers.

Models expose supported actions and provider routes.

Tools reference actions only.

agent_runs records execution metadata, tokens, timing, steps and output metadata.

