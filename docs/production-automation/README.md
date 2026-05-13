# Production Automation Preparation

v1 uses manual n8n workflows. Production automation should be gradual and reversible:

1. Manual workflow
2. Scheduled daily digest
3. Polling pending bookings
4. Real AI provider
5. Only later, possible event-driven trigger

No direct WeChat auto-send is included or recommended for v1.1. Staff must remain in the loop.

## Files

- [n8n scheduler upgrade plan](n8n-scheduler-upgrade-plan.md)
- [Daily digest schedule design](daily-digest-schedule-design.md)
- [Booking follow-up polling design](booking-follow-up-polling-design.md)
- [Human-in-the-loop policy](human-in-the-loop-policy.md)
