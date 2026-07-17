# Vorinthex Founders Gate — Beacon Interface V1

## Objective

Build the first authenticated founder-facing interface for Vorinthex.

This interface is called **Founders Gate**.

It is not a general customer dashboard. It is only available to authenticated users who are active members of the root organization representing Vorinthex itself.

The implementation must include:

1. A minimal authenticated frontend shell.
2. A left navigation panel.
3. Organization selection.
4. Scope selection.
5. An account footer.
6. A minimal account page.
7. A floating Beacon input island.
8. Streaming Beacon responses.
9. A secure backend endpoint for asking Beacon.
10. Root-organization access control on both frontend and backend.

Do not build anything beyond this V1 scope.

---

## Core Product Model

The complete interaction is:

```text
Select Organization
↓
Select Scope
↓
Ask Beacon
↓
Receive Streaming Response
```

There is no conversation history in V1.

There are no saved chats, chat IDs, message collections, chat sidebar, agent browser, dashboard, activity panel, artifact panel, run panel, scope creation, organization creation, or member management.

The active request and response are ephemeral and disappear on refresh.

---

## Access Boundary

A user may access Founders Gate only when:

```text
User is authenticated
AND
User is an active member of the root organization
```

For every Beacon request, the backend must additionally verify:

```text
User belongs to the selected organization
AND
User may access the selected scope
AND
Selected scope belongs to selected organization
```

Frontend route guards are not sufficient security.

The backend must independently resolve the authenticated user and verify all memberships and permissions from canonical database state.

Never trust organization, scope, user, role, agent, model, or provider claims supplied by the client.

Use one canonical root-organization configuration or database lookup, such as:

```text
ROOT_ORGANIZATION_KEY
```

or:

```text
ROOT_ORGANIZATION_SLUG
```

Do not hardcode the same root CUID across unrelated files.

---

## Existing Architecture First

Before writing code, inspect and reuse the existing implementation for:

```text
Authentication
Sessions
Users
Organizations
UserOrganizations
Scopes
ScopeMembers
ScopeScopes
ScopeAgents
Agents registry
Beacon agent
Agent runtime
AgentContext compiler
Actions
Tools
Router
Models
Providers
OrganizationProviders
Streaming utilities
TanStack Query
Axios
Zod
Shared UI
Shared icons
Authenticated layouts
Background texture
Error handling
```

Do not create duplicate membership, permission, routing, session, or AI-runtime systems.

The frontend must call the backend.

The backend must invoke the existing agent runtime.

The browser must never call an AI provider directly.

---

## Visual Direction

Use the existing Vorinthex design system.

The interface should feel:

```text
Obsidian intelligence
Dark
Premium
Metallic
Precise
Futuristic
Calm
High contrast
Low clutter
```

Use the existing authenticated background texture as the primary visual surface.

Most elements should have no independent opaque background.

Do not cover the texture with a full-page card, large panel, dashboard grid, or opaque sidebar.

Only these controls may use subtle contained surfaces:

```text
Organization selector
Scope selector
Dropdown menus
Floating Beacon input island
Account fields where necessary
Response surface when readability requires it
```

Use restrained translucent obsidian surfaces:

```css
background: rgba(8, 11, 15, 0.72);
border: 1px solid rgba(221, 226, 229, 0.12);
backdrop-filter: blur(18px);
box-shadow:
  inset 0 1px 0 rgba(255,255,255,0.06),
  0 24px 80px rgba(0,0,0,0.38);
```

Use black, gunmetal, silver, platinum, and controlled cold metallic highlights.

Do not use bright accent colors, generic blue SaaS styling, colorful status pills, excessive gradients, or decorative clutter.

---

## Page Structure

Build one authenticated shell:

```text
Founders Gate
├── Left Panel
└── Main Beacon Area
```

Desktop:

```text
┌──────────────────────┬──────────────────────────────────────────┐
│ Organization         │                                          │
│ Scope                │ Main Beacon Area                         │
│                      │                                          │
│                      │ Streaming Response                       │
│                      │                                          │
│                      │                                          │
│ Account Footer       │ Floating Beacon Input Island             │
└──────────────────────┴──────────────────────────────────────────┘
```

Do not add a right panel.

Do not add chat history, agent navigation, breadcrumbs, analytics, cards, or product navigation.

---

## Left Panel

The left panel contains exactly:

```text
Organization Selector
Scope Selector
Flexible Empty Space
Account Footer
```

Suggested desktop width:

```text
260px to 300px
```

Keep the panel mostly transparent.

A subtle divider is allowed:

```css
border-right: 1px solid rgba(221, 226, 229, 0.08);
```

The panel must not contain chats, agents, artifacts, files, runs, notifications, search, dashboards, create buttons, or admin links.

---

## Organization Selector

Place the organization selector at the top.

It may show only organizations the authenticated user already belongs to.

It must not allow organization creation.

Suggested option shape:

```ts
type AccessibleOrganizationOption = {
  key: string;
  name: string;
  alias: string | null;
};
```

When the organization changes:

```text
Cancel active Beacon stream
Clear current response
Set active organization
Clear invalid active scope
Fetch accessible scopes
Select a valid default scope
```

A locally stored organization preference is allowed only if validated against freshly fetched accessible organizations.

---

## Scope Selector

Place it directly below the organization selector.

It may show only accessible scopes inside the selected organization.

It must not create, edit, move, delete, or manage scopes.

Suggested option shape:

```ts
type AccessibleScopeOption = {
  key: string;
  name: string;
  position: number;
  parentKey: string | null;
  path: string[];
};
```

Default selection order:

1. Last locally selected valid scope for this organization.
2. Accessible organization root scope.
3. First accessible scope by hierarchy and position.
4. No selection if no accessible scopes exist.

Disable Beacon when no valid scope exists.

---

## Account Footer

Place a clickable account footer at the bottom of the left panel.

Display:

```text
Avatar or initials
Display name
Short secondary value such as organization role or alias
Chevron
```

Clicking it opens a dedicated account page.

Do not build a large account popover.

---

## Account Page

Suggested route:

```text
/founders/account
```

Display read-only values:

```text
Name
Alias
Email
Root Organization Role
Application Role if distinct
Current Organization
Logout
```

Do not allow role editing, organization management, billing, API keys, security settings, member management, or provider configuration.

Use subtle dividers rather than many cards.

Logout must use the existing authentication flow.

---

## Main Beacon Area

The main area contains only:

```text
Optional minimal welcome state
Current streaming Beacon response
Floating Beacon input island
```

Do not render message bubbles.

Do not render a conversation timeline.

Do not persist messages or responses.

Before the first request, a minimal state may say:

```text
Ask Beacon
Your gateway to the right intelligence.
```

Keep this understated.

---

## Floating Beacon Input Island

Place a floating input island near the bottom center of the main area.

It must not be attached to the viewport edge.

Suggested desktop width:

```text
760px to 900px maximum
```

Suggested bottom spacing:

```text
24px to 36px
```

The island may use a subtle obsidian surface, chrome border, soft blur, and restrained metallic focus glow.

Support:

```text
Multiline input
Enter to submit
Shift + Enter for newline
Submit button
Cancel button while streaming
Disabled state
Loading state
Error state
```

Suggested input limit:

```text
20,000 characters
```

Validate on client and server.

Reject empty or whitespace-only input.

Allow only one active request from the current UI instance.

---

## Beacon Response

Render one clean document-like response above the input island.

Stream it progressively.

Do not wait for the full response.

Do not use chat bubbles.

Use the existing safe Markdown renderer if one exists.

Never allow arbitrary HTML.

Support code blocks and basic Markdown only through existing sanitized infrastructure.

Keep response width aligned with the input island.

Use no response background unless the texture compromises readability.

---

## Ephemeral UI State

Use local state or a focused hook:

```ts
type BeaconUiState = {
  input: string;
  response: string;
  status:
    | "idle"
    | "connecting"
    | "streaming"
    | "completed"
    | "failed"
    | "cancelled";
  error: string | null;
};
```

Do not persist this state.

A refresh resets the interaction.

Do not create chats, conversations, messages, or history collections.

---

## Beacon Identity

Use the canonical system agent:

```text
Name: Beacon
Title: AI Coordinator
Slug: beacon
```

The frontend must not send an editable `agentKey`.

The backend resolves Beacon by immutable slug or configured key.

Beacon is stateless.

Every ask creates a new isolated run.

Multiple founders must be able to ask Beacon concurrently.

Append-only agent memory may be loaded into future runs, but no active state is stored on the Beacon node.

---

## Backend Endpoint

Create or reuse a secure streaming endpoint, for example:

```text
POST /api/founders/beacon/ask
```

Request schema:

```ts
export const foundersBeaconAskSchema = z.object({
  organizationKey: z.string().cuid(),
  scopeKey: z.string().cuid(),
  message: z.string().trim().min(1).max(20_000),
});
```

Do not accept:

```text
userKey
agentKey
modelKey
providerKey
role
permissions
tool keys
```

The backend resolves all of them.

---

## Backend Authorization Sequence

Run this before any model call:

```text
Resolve authenticated user
↓
Require active session
↓
Require active root-organization membership
↓
Require membership in selected organization
↓
Require selected scope belongs to selected organization
↓
Require access to selected scope
↓
Resolve Beacon server-side
↓
Compile AgentContext
↓
Execute Beacon
↓
Stream response
```

Root membership grants access to Founders Gate.

Selected organization membership grants access to that organization.

Scope permission grants access to that scope.

All three are required.

Do not leak inaccessible organizations or scopes.

---

## Runtime Invocation

Use the existing chain:

```text
Beacon endpoint
↓
Create isolated AgentRun
↓
Compile AgentContext
├── authenticated user
├── selected organization
├── selected scope
├── Beacon agent
├── Beacon skills
├── Beacon tools
├── relevant append-only memories
├── permissions
├── guardrails
└── current task
↓
Resolve action
↓
Router
↓
Model
↓
Enabled provider
↓
Stream user-facing response
```

Do not bypass:

```text
modelActions
modelProviders
organizationProviders
```

Do not hardcode model or provider selection in the frontend.

---

## V1 Beacon Capability

V1 requires only a basic ask path.

Beacon may:

```text
Understand the request
Answer directly when possible
Use its configured ask or reason route
Return streamed user-facing text
```

Do not build delegation UI, child-run UI, agent selection, or orchestration controls in this task.

Preserve existing delegation capabilities if already implemented, but do not expose them visually.

---

## Streaming Protocol

Use an existing streaming abstraction if available.

Acceptable implementations:

```text
Server-Sent Events
Fetch ReadableStream
Existing repository stream protocol
```

Use minimal lifecycle events:

```text
response.started
response.delta
response.completed
response.failed
```

Example:

```text
event: response.started
data: {}

event: response.delta
data: {"text":"Hello"}

event: response.completed
data: {}
```

Never stream hidden reasoning, chain-of-thought, provider credentials, raw internal tool payloads, or private runtime context.

Only stream user-facing text and minimal lifecycle signals.

---

## Client Streaming Hook

Build a focused hook such as:

```text
useBeaconStream
```

It should:

```text
Submit request
Create AbortController
Read stream
Parse events
Append deltas
Expose status
Expose error
Cancel
Reset
Clean up on unmount
```

Do not use TanStack Query for the response stream.

Use TanStack Query only for canonical server state:

```text
Authenticated account
Accessible organizations
Accessible scopes
Membership details
```

Suggested query keys:

```ts
["founders-gate", "me"]

["founders-gate", "organizations"]

["founders-gate", "organization", organizationKey, "scopes"]

["founders-gate", "organization", organizationKey, "membership"]
```

Follow existing conventions where different.

---

## Loading and Empty States

While validating access, show a minimal full-page loading state without flashing protected content.

If no organizations are accessible:

```text
No accessible organizations.
```

If no scopes are accessible:

```text
No accessible scopes in this organization.
```

Disable Beacon input in both cases.

If Beacon cannot execute:

```text
Beacon is not available in this scope.
```

Log technical details server-side, not in the browser.

---

## Error Handling

Handle:

```text
Unauthenticated
Not a root member
Inactive membership
Organization inaccessible
Scope inaccessible
Cross-organization scope
Beacon missing
No valid model route
Provider unavailable
Stream interrupted
Timeout
Cancellation
Malformed stream
Unexpected server failure
```

Do not expose stack traces, provider payloads, secrets, or internal database details.

---

## Responsive Behavior

Desktop:

```text
Persistent left panel
Open main canvas
Centered floating input
```

Mobile:

```text
Left panel becomes a drawer
Organization and scope remain accessible
Account footer remains accessible
Input uses safe horizontal margins
Response fills available width
```

Do not hide current organization or scope context on mobile.

---

## Accessibility

Implement:

```text
Keyboard navigation
Visible focus states
ARIA labels
Escape closes selectors
Enter submits
Shift + Enter inserts newline
Screen-reader streaming status
Sufficient contrast
Reduced-motion support
```

---

## Motion

Use subtle motion only:

```text
Dropdown fade
Soft scale
Input focus glow
Streaming cursor
Mobile drawer
```

Avoid large parallax, particles, bouncing controls, constant background animation, or bright pulsing effects.

---

## Privacy and Security

The implementation must:

```text
Authenticate every protected request
Authorize root membership
Authorize selected organization
Authorize selected scope
Validate input with Zod
Rate-limit through existing infrastructure when available
Abort work after cancellation when practical
Avoid storing ephemeral messages
Avoid logging raw message content unnecessarily
Never expose provider credentials
Never trust client-selected roles
Never trust client-selected agent identity
Prevent cross-organization access
```

The existing runtime may still create operational records such as:

```text
agentRuns
agentRunSteps
agentRunCalls
events
```

Do not add duplicate chat persistence.

Do not store full prompts or outputs in generic events.

---

## Implementation Order

### Frontend First

1. Inspect authenticated shell and background texture.
2. Create Founders Gate protected route.
3. Build left panel.
4. Connect organization selector to real data.
5. Connect scope selector to real data.
6. Build account footer.
7. Build account page.
8. Build main Beacon canvas.
9. Build floating input island.
10. Build streaming response renderer.
11. Use a temporary local stream adapter only when required.
12. Do not stop at mocks.

### Backend Second

1. Create reusable Founders Gate authorization guard.
2. Create or reuse accessible-organization query.
3. Create or reuse accessible-scope query.
4. Create or reuse account endpoint.
5. Add Beacon ask schema.
6. Add secure streaming endpoint.
7. Resolve Beacon server-side.
8. Compile AgentContext.
9. Execute through existing action, router, model, and provider chain.
10. Stream user-facing deltas.
11. Handle cancellation and failures.
12. Connect the frontend to the real endpoint.

---

## Explicitly Out of Scope

Do not build:

```text
Saved chats
Chat history
Conversation sidebar
Agent directory
Agent selector
Agent run panel
Artifact panel
Event timeline
Tool panel
Model selector
Provider selector
Organization creation
Scope creation
Scope editing
Member management
Provider management
Billing
Notifications
Search
File upload
Voice
Image generation
Multi-agent orchestration UI
Neural Code
Studio UI
Command dashboard
Headquarters UI
Replica UI
Pilot product UI
```

---

## Testing

### Frontend

Test:

```text
Root member can open Founders Gate
Non-root member is blocked
Anonymous user is blocked
Only accessible organizations appear
Only accessible scopes appear
Changing organization clears invalid scope
Beacon is disabled without valid context
Enter submits
Shift + Enter inserts newline
Streaming deltas append progressively
Cancel aborts stream
Account footer opens account page
Logout works
```

### Backend

Test:

```text
Anonymous request rejected
Non-root member rejected
Inactive root membership rejected
Inaccessible organization rejected
Inaccessible scope rejected
Cross-organization scope rejected
Malformed message rejected
Empty message rejected
Oversized message rejected
Beacon resolved server-side
Client cannot override agent
Client cannot override model
Client cannot override provider
Valid request creates isolated run
Concurrent founders can ask Beacon
Response streams progressively
Provider failure becomes safe stream error
Cancellation terminates safely
```

### Integration

Verify:

```text
Authenticate root member
↓
Open Founders Gate
↓
Select organization
↓
Select scope
↓
Ask Beacon
↓
Receive streamed response
↓
Open account page
↓
Log out
```

---

## Acceptance Criteria

The work is complete only when:

```text
Only active root-organization members can access Founders Gate
The backend independently enforces access
The existing background texture stays visible
The left panel contains only selectors and account footer
Organization switching uses real accessible data
Scope switching uses real accessible data
No organization or scope creation exists here
The account page shows required identity and role data
Logout works
The main area remains minimal
The Beacon input floats near the bottom
Beacon can be asked through the backend
The response streams progressively
No chats or conversation history are stored
Beacon runs are isolated and concurrent
Organization and scope access are validated server-side
The existing AI runtime is used
The frontend never calls providers directly
Typecheck passes
Lint passes
Tests pass
```

---

## Final Report

Return:

```text
Created files
Modified files
Final route structure
Final component tree
Backend endpoints
Authorization flow
Root organization resolution
Organization query behavior
Scope query behavior
Beacon runtime flow
Streaming protocol
Cancellation behavior
Account fields
Tests added
Typecheck result
Lint result
Deviations
```

---

## Final Product Principle

Founders Gate V1 is not a dashboard.

It is not a saved chat product.

It is not an agent browser.

It is a secure, minimal founder interface where authorized root-organization members select an organization, select a scope, ask Beacon, and receive a streamed response.

The interface should feel almost empty.

The intelligence should feel immediate.