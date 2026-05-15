# Admin Operations UI & Dark Theme Tokens

## Scope

- Admin Settings (`/settings`) card-based operational dashboard: retention, audit log, config version history, health summary, alerting, system footer.
- Global dark mode surfaces (shell, sidebar, header, tables) using shared `gdc` Tailwind color tokens aligned with the platform dark-mode guide.
- REST: `/api/v1/admin/retention-policy`, `audit-log`, `config-versions`, `health-summary`, `alert-settings`; extended `GET /admin/system`.

## Out of scope

- Full RBAC enforcement, notification delivery workers, automated retention janitor, config diff/rollback.

## Constraints

- Product UI strings remain English-only.
- Do not modify StreamRunner semantics; audit hooks live outside runner core.
