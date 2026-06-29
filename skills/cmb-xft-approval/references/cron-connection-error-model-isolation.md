# Cron Connection Error — Model Isolation Fix

## Symptom

Cron job `xft-session-selfheal` reports `RuntimeError: Connection error.` after the main Hermes model/provider is changed. The cron inherits the main model config and breaks when the new provider is unreachable or overloaded.

Log pattern:
```
WARNING agent.conversation_loop: API call failed (attempt 1/3) error_type=APIConnectionError provider=deepseek model=deepseek-v4-pro
```

## Root Cause

When a cron job has `model: null` and `provider: null` in its config, it inherits the main session's model/provider. If you switch your main model to a new provider, **all crons without their own model config will follow** and may break.

## Fix

Give the cron its own model config — decoupled from the main model:

```bash
# Edit ~/.hermes/cron/jobs.json, find the job entry, add:
"model": "deepseek-v4-flash",
"provider": "deepseek",
"base_url": "https://api.deepseek.com"
```

Or via Python:
```python
import json
with open('~/.hermes/cron/jobs.json') as f:
    data = json.load(f)
for j in data['jobs']:
    if j['id'] == '<CRON_ID>':
        j['model'] = 'deepseek-v4-flash'
        j['provider'] = 'deepseek'
        j['base_url'] = 'https://api.deepseek.com'
```

## Verification

1. Confirm model is set in cron config: `hermes cron list`
2. After next cron run, check `last_status` is `ok`
3. For XFT specifically: manually run `navigate.mjs homepage` to verify session is alive (Connection error may be LLM API, not XFT session)

## Prevention

When switching your main model:
1. List all crons: `hermes cron list`
2. Check which crons have no explicit model (`model: None`)
3. Either give them their own model, or verify the new model works for them
4. Test with a manual `hermes cron run <ID>` before relying on automatic scheduling
