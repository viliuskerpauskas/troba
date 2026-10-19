# Triage labels

The skills speak of five triage roles. This maps them to troba's labels.

| Role in the skills | Label here | Meaning |
|---|---|---|
| `needs-triage` | `needs-triage` | The owner needs to evaluate it |
| `needs-info` | `question` | Waiting for more information |
| `ready-for-agent` | `ready-for-agent` | A ticket with acceptance criteria, ready for `/implement` |
| `ready-for-human` | `ready-for-human` | Needs the owner: a setting, an account, a decision |
| `wontfix` | `wontfix` | Will not be done |

troba adds:

| Label | Meaning |
|---|---|
| `spec` | A spec issue: the parent of a feature's tickets, never implemented directly |
| `platform`, `identity`, `money` | The module, on every spec and ticket |
| `security` | Touches auth, `user_id` filtering, uploads or money; gets the full security section of [CODING_STANDARDS.md](../../CODING_STANDARDS.md) in review |
| `blocked-external` | Waiting on something outside the repo (a VPS, a domain) |

When a label the skills need is missing, create it with `gh label create <name>` before applying it.
