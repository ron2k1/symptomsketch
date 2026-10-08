# BOARD: coordination log for parallel build agents

Workflow agents cannot message each other directly, so this file is the shared channel.

Rules:

1. Append only. Never edit or delete another agent's entry. Re-read this file before you start,
   before you touch a shared boundary, and before you finish.
2. Entry format: `- [<agent-id>] <TYPE>: <one line>` where TYPE is one of
   `CLAIM` (I own this path), `NEED` (I need X from owner Y), `PROVIDE` (X is now available at path),
   `CHANGE` (I changed a shared contract; consumers must adapt), `DONE` (my slice is finished + gates I ran).
3. Contract changes go in `packages/contracts` first, then a `CHANGE` line here naming the export.
4. If you need something another agent owns and it is not there yet, write a `NEED` line, code
   against the contract type, and continue. Do not edit files another agent has `CLAIM`ed.

## Ownership map (pre-assigned)

| Agent     | Owns                                                                                                                                                                 |
| --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| architect | `packages/contracts/**`, `apps/server/src/{main,app,config}.ts`, `apps/server/src/http/**`, `apps/web/src/{App,main}.tsx`, `apps/web/src/lib/**`, route + page stubs |

## Log
