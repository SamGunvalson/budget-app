# Documentation index

Use the [README](../README.md) for the feature overview and repository map. Each topic below has one primary guide.

| Task | Guide |
| --- | --- |
| Develop locally, use the dev container, or troubleshoot Windows setup | [Setup guide](./SETUP_GUIDE.md) |
| Deploy with Supabase, Docker, or self-hosted PostgreSQL | [Setup guide](./SETUP_GUIDE.md) |
| Build, sign, or update the Android app | [Android guide](./android-app.md) |
| Check database columns, constraints, RLS/RPC contracts, or migrations | [Data model](./DATA_MODEL.md) |
| Choose fresh-install SQL versus historical fixes | [SQL setup](../sql_scripts/README.md) and [migration guide](../sql_scripts/migrations/README.md) |
| Follow the read/write architecture and coding invariants | [Contributor instructions](../.github/AGENTS.md) |
| Build components, navigation, charts, or dark-mode styles | [Style guide](./STYLE_GUIDE.md) |
| Understand current security boundaries | [Security model](./SECURITY.md) |
| Review changes against security invariants | [Security checklist](./SECURITY_CHECKLIST.md) |
| Scope and review AI-assisted changes | [Context guide](./CONTEXT_GUIDE.md) |
| Configure the local auth API, CLI, or tests | [Auth-service README](../server/auth/README.md) |
| Migrate Supabase data to self-hosted PostgreSQL | [Migration guide](../scripts/migrate-from-supabase/README.md) |
| Understand local roles, grants, initialization, and RLS checks | [Local SQL README](../sql_scripts/local/README.md) |
| Inspect current performance surfaces and remaining measurement work | [Performance index](./performance/README.md) |
| Read historical implementation plans and reviews | [Archive index](./archive/README.md) |

Run the checks documented under [validation](./SETUP_GUIDE.md#validation) before shipping changes. Historical plans are not current setup instructions.
