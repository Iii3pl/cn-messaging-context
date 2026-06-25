# Audit Model

The connector writes audit events for:

- Webhook ingestion.
- History sync.
- Message send requests.
- DingTalk OA pending-list reads.
- DingTalk OA approval actions.

Each audit event includes:

- `id`
- `timestamp`
- `action`
- `tenant_id`
- `platform`
- `conversation_id` when relevant
- `status`
- metadata such as message counts, task ids, confirmation summaries, and text length

Audit records intentionally avoid storing platform secrets or full access tokens.

## Recommended Production Additions

- Actor identity from the Codex session or enterprise identity provider.
- Request id and trace id.
- IP and device metadata when policy allows it.
- Immutable append-only audit storage.
- Export to SIEM or security review tooling.
- Retention and deletion workflow.
