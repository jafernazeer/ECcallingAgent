# Retell tool configuration

Companion to `retell-prompt.md`. The prompt says *what* the agent should do;
these settings control *when it is allowed to speak* around each tool call.
Recorded here because a wrong flag here breaks the call in ways the prompt
cannot fix.

Agent: `agent_32ed880947c418370d19839958`
LLM: `llm_3c5362091173544e29c01f90e6dd`

| Tool | Type | speak_during | speak_after | Fires |
|---|---|---|---|---|
| `capture_identity` | custom | false | true | after name, company and location are each confirmed |
| `capture_requirement` | custom | false | true | after the qualifying exchange |
| `capture_contact` | custom | false | true | after both phone and email are read back and confirmed |
| `submit_lead` | custom | false | true | once, at sign-off |
| `end_call` | end_call | **true** | **false** | after the Step 13 sign-off |

## Why `end_call` is configured differently

`end_call` is a Retell built-in that terminates the session the instant it
fires. `speak_after_execution` is therefore meaningless on it — there is no
"after"; the call is already gone.

It was previously set to `speak_after_execution: true`, and the result was that
the model chained `capture_contact` → `submit_lead` → `end_call` the moment the
caller confirmed their email, and the line dropped before Step 13's sign-off was
ever spoken. Callers heard the call end immediately after saying "correct" —
abrupt, though no data was lost, since both capture tools fired first.

The fix is `speak_during_execution: true` with the sign-off as the execution
message, so Retell speaks the line as part of ending the call:

> Perfect. Our team will review your requirements and reach out shortly. Thank you for contacting EthikCorp, and have a great day!

That line also matters portal-side: `AGENT_GOODBYE_PATTERN` in
`src/lib/callHelpers.js` matches "have a great day", which is how a web call
closes cleanly at the browser end. Change the wording in one place and it must
change in the other.

## If you edit these in the dashboard

The agent is unpublished, so new calls use the latest version automatically.
Publishing it pins a version, and edits then need a republish to reach live
calls.
