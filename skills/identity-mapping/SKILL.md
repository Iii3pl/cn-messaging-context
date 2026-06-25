---
name: identity-mapping
description: Map Feishu/Lark and DingTalk user ids, display names, and aliases to one canonical person for triage and reply routing.
---

# Identity Mapping

Use this skill when the user says two platform names or ids refer to the same person, or when notification triage misses the user because Feishu/Lark and DingTalk names differ.

## Workflow

1. Use `resolve_identity` to check whether the person is already mapped.
2. Use `upsert_identity_mapping` to add or update a platform-specific mapping.
3. Use `list_identity_mappings` to confirm the canonical user, platform id/name, and aliases.
4. Then pass the canonical name as `current_user` to `triage_today`, `find_reply_candidates`, or `draft_reply_queue`.

## Boundaries

- Do not store private contact details, secrets, phone numbers, or tokens as aliases.
- Keep mappings limited to work identity handles needed for message routing.
- If the user is unsure whether two names are the same person, label the mapping as unconfirmed in the alias text or ask before saving it.
