# Complete Agent Architecture

## Organization

- Users
- Scopes
- Enabled Providers
- Agent Runs

## Registries

- Agents
- Skills
- Tools
- Actions
- Models
- Providers

## Linking Nodes

- User Organizations
- Scope Scopes
- Scope Members
- Agent Skills
- Agent Tools
- Tool Actions
- Model Actions
- Model Providers
- Agent Run Sources

## Runtime

AgentContext contains Organization, Scope, Agent, ordered Skills, granted
Tools, normalized Knowledge, derived Permissions, Guardrails, and Current Task.

## Execution

Tool -> Action -> Router -> Model -> Provider -> Response

## Execution History

- Agent Run
- Agent Run Steps
- Agent Run Calls
- Agent Artifacts
- Agent Artifact Checks
- Agent Memories

## Security Contract

Member execution requires an active User Organization link and membership in
the agent Scope. Provider execution requires the persisted Organization
Provider allow-list. Trusted internal workflows use an explicit system
principal. Every run records its principal type and member link when present.
