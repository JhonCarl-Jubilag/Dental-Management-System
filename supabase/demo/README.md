# One-time clinic demo data

This folder is deliberately outside migrations. Do not apply it automatically.

The SQL creates 8 fictional patients, 32 appointments, 28 bills and 24 treatments linked to existing active dentists/services. It preserves clinic accounts, providers, services, inventory, attendance, activity history and identity sequences. Existing schedules are preserved; missing future working days receive demo availability.

The review script ends in ROLLBACK. It checks the exact reviewed data fingerprint, the eight separately provisioned Auth accounts, the linked billing/treatment data, preservation checks and notification isolation. A separate private execution copy is prepared only for the reviewed reset.

A verified full database backup is required before execution. The execution copy permanently removes the 7 reviewed old patient Auth accounts and their patient records, 30 appointments, 11 bills and 4 treatments. Auth accounts outside that exact old patient set remain unchanged.

Demo login credentials are stored privately outside the repository. Never commit server keys, passwords or database dumps. Appointment emails remain disabled because demo addresses and notes are fictional.

The script is specific to the reviewed database snapshot. If records change, it intentionally stops; refresh the backup and review rather than removing the guard.
