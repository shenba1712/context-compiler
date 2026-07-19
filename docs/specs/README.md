# Context Compiler — product & engineering specs

Working specs for the MCP server and hosted demo. Contracts and intent are preferred over exhaustive env dumps; behavior is grounded in the current `src/` tree.

| Doc | Description |
| --- | --- |
| [01-prd.md](./01-prd.md) | Product requirements: problem, goals, users, primary flows, success metrics |
| [02-technical-requirements.md](./02-technical-requirements.md) | Runtime, performance/abuse budgets, reliability, observability, security baselines |
| [03-information-architecture.md](./03-information-architecture.md) | Surfaces, content objects, demo navigation, sample library |
| [04-compatibility-matrix.md](./04-compatibility-matrix.md) | Formats, browsers, MCP clients, LLM providers, OS/runtime, hosting |
| [05-ui-ux-flow.md](./05-ui-ux-flow.md) | Happy paths and edge states for the demo UI |
| [06-api-specifications.md](./06-api-specifications.md) | HTTP routes and MCP tool contracts |
| [07-schema.md](./07-schema.md) | Request/response and in-memory handle shapes (no database) |
| [08-design-system.md](./08-design-system.md) | Tokens, type, components, motion, and a11y for the demo UI |
| [09-devops.md](./09-devops.md) | Docker, Render, CI, health/metrics, secrets, ephemerality |
| [10-test-plan.md](./10-test-plan.md) | Unit/integration/eval coverage and deliberate non-assertions |
| [11-threat-model.md](./11-threat-model.md) | Actors, assets, threats, mitigations, residual risk |
| [12-adrs.md](./12-adrs.md) | Architecture Decision Records (context / decision / consequences) |
