# Grant Guardian Architecture

Grant Guardian uses Notion as the visible operating layer and keeps humans in the loop for sensitive actions.

> A 2-person nonprofit team applies to 40 grants a year. They win 6. Grant Guardian changes that math.

The architecture exists to make a very small team feel much larger without pretending the human should disappear. The system is designed to reduce opportunity triage time, make submission prep repeatable, and keep the full grant lifecycle visible in Notion.

## Core decisions

- `Gemini API` is the primary model provider
- `Notion MCP` is the default workspace integration path
- `https://mcp.notion.com/mcp` is the default MCP endpoint
- Notion authentication is treated as `OAuth with human approval`
- `Submittable` is the first supported portal workflow

## System layers

1. Intake and parsing
2. Funder intelligence via ProPublica + 990-PF parsing
3. Evidence matching and coverage
4. Grounded drafting + Grant DNA alignment
5. Review and approval orchestration in Notion
6. Submission assistance
7. Post-award reporting
