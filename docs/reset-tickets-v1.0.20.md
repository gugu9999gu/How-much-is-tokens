# Reset tickets — v1.0.20

## OpenAI Codex / Work

The widget reads the official Codex app-server method `account/rateLimits/read`.

When `rateLimitResetCredits` is present:

- `availableCount` is treated as the authoritative available reset count.
- `credits[]` detail rows are used only when supplied by the backend.
- Detail rows expose `resetType`, `status`, `grantedAt`, `expiresAt`, `title`, and `description`.
- The widget displays the reset count and up to three soonest expiry rows as D-day + ISO date.
- `credits: null` means count-only data; the widget does not invent individual expiry dates.
- A truncated detail list never replaces the authoritative `availableCount`.
- Expired detail rows are not shown as valid tickets.

This integration is read-only. The widget never calls `account/rateLimitResetCredit/consume`.

A full banked Codex reset can refresh eligible 5-hour and weekly Codex usage windows. It is not a generic ChatGPT message-limit reset or API credit.

## Grok

The existing Grok provider continues to show the official shared billing-period reset time returned by xAI billing data. No one-time reset-ticket count or expiry is fabricated because the current machine-readable Grok billing payload does not expose a documented reset-ticket inventory equivalent to Codex banked resets.
