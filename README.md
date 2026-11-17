# Diolata Dental Clinic Management System

React application for patient bookings and treatment history, clinic operations, billing, inventory, reports, staff accounts, and daily time records. Supabase provides authentication, database access, and Edge Functions.

## Development

- Install the locked dependencies with `npm ci`.
- Configure the required public Supabase settings in the local `.env` file; see `src/services/supabase.js` for the variable names. Never put a service-role key or database password in React environment variables.
- Run `npm start` for local development.
- Run `npm run build` to generate the production `build` folder.

## Project folders

- `src/pages/public`: landing page, login, registration, and account verification/recovery.
- `src/pages/patient`: service details, appointment booking, appointments, profile, and treatment history.
- `src/pages/admin`: shared Owner/Staff clinic pages. Settings and staff-account management require Owner access.
- `src/components`, `src/services`, `src/utils`: shared UI, database calls, document generation, and scheduling helpers.
- `src/assets`, `public`: imported media/fonts and browser entry files/icons.
- `supabase/functions`: account-management and email functions. Deployment entry points are declared in `supabase/config.toml`.
- `supabase/migrations`: ordered database history. Keep rollback and replacement migrations; do not remove older files simply because newer migrations supersede them.
- `supabase/demo`: manually reviewed sample-data scripts. They are not normal migrations and must not be applied automatically.

## Deployment and data safety

The frontend build and Supabase functions/database changes are separate deployment steps. Apply only reviewed database updates for the intended project. Keep secrets, private account lists, recovery copies, and database backups outside Git. The `vercel.json` rewrite supports direct navigation to application routes.

Dentists are clinic provider profiles; they do not have a primary login role. The login roles are Owner (`super_admin`), Staff (`admin`), and Patient (`patient`). Backend checks and database policies enforce access in addition to protected frontend routes.
