# Ceazers 3D Admin: setup guide

The private admin app lives at **`/admin`**. It covers quotes, invoices, deposits and payments, clients, saved items, internal costing, reports, settings and CSV migration.

It runs on **Supabase**, which provides the Postgres database, login and private file storage. The code is complete. To switch it on you need a Supabase project and three environment variables in Vercel. Plan on about 30 minutes.

---

## 1. Create the Supabase project

1. Go to https://supabase.com, sign in and click **New project**.
2. Name it `ceazers3d-admin`, choose a strong database password and save it in your password manager.
3. Choose the region closest to you. Supabase has no African region, so London or Frankfurt is typical.
   > POPIA: client details will be stored outside South Africa. That is allowed when the provider gives adequate protection, which Supabase does (it is SOC 2 and GDPR aligned), but mention it in your privacy notice.
4. Wait for the project to finish provisioning.

## 2. Create the database

1. In Supabase, open **SQL Editor** and click **New query**.
2. Paste the whole of `supabase/migrations/0001_admin_schema.sql` and click **Run**. It should report *Success*.
3. Open another new query, paste `supabase/migrations/0002_admin_storage.sql` and click **Run**.
4. In **Storage**, confirm the buckets `documents` and `branding` exist. Both must be marked **Private**.

> Do **not** run anything in `supabase/test/`. Those files are a local stand-in used only by the automated tests.

## 3. Lock down sign-in

Under **Authentication**:

- **Sign In / Providers → Email**:
  - Turn **"Allow new users to sign up" OFF**. Only people you invite can get an account.
  - Keep "Confirm email" ON.
  - Set the minimum password length to **12**.
- **Sign In / Providers → Multi-Factor**: make sure **TOTP** (authenticator app) is enabled. It is on by default.
- **URL Configuration**:
  - Site URL: `https://ceazers3d.com/admin/`
  - Redirect URLs: add `https://ceazers3d.com/admin/?setpw=1`. Optionally also add `http://localhost:3000/admin/?setpw=1`.
- **Emails → SMTP Settings**: set up your own SMTP, for example through the email host for ceazers3d.com. Supabase's built-in email only sends a few messages per hour, which is not enough for invites and password resets.
- **Rate Limits**: keep the defaults or make them stricter.

## 4. Create your owner account

1. Go to **Authentication → Users → Add user → Create new user**.
2. Enter your email and a strong password, and tick **Auto confirm user**.
3. In the **SQL Editor**, run the following. Change the email and name to yours.

```sql
insert into public.profiles (id, email, full_name, role)
select id, email, 'Siyabonga Masiza', 'owner'
from auth.users where email = 'siyabonga.masiza@ceazers3d.com';
```

Without a row in `profiles`, an account can sign in but sees nothing. Access is granted per profile, not per login.

## 5. Connect Vercel

In **Supabase → Project Settings → API**, copy the **Project URL**, the **anon public** key and the **service_role** key.

In **Vercel → ceazers-3d → Settings → Environment Variables**, add the following for **Production**. Add them to Preview too if you want the admin to work on preview deployments.

| Name | Value | Notes |
|---|---|---|
| `SUPABASE_URL` | `https://<ref>.supabase.co` | |
| `SUPABASE_ANON_KEY` | the anon public key | Public by design. Row-level security protects the data. |
| `SUPABASE_SERVICE_ROLE_KEY` | the service_role key | **Secret.** Mark it *Sensitive*. Only `api/admin-users.js` uses it, on the server. Never put it in browser code. |

Redeploy afterwards. Environment variables only apply to new deployments.

## 6. First sign-in

1. Open https://ceazers3d.com/admin and sign in.
2. **Settings → Security → Turn on two-step verification.** Do this first. Once it is on, the database refuses password-only sessions for your account.
3. Fill in the rest of Settings:
   - **Company profile:** VAT number and bank details (bank details print on invoices).
   - **Logo & signature:** upload PNG, JPG or WebP files.
   - **Tax, currency & dates:** the default is 15% VAT added to prices, and dates as `06/Nov/2026`.
   - **Document defaults:** 7-day terms, 30-day quote validity, 50% deposit.
   - **Costing & materials:** your machine, electricity, labour and design rates, plus the cost of your filaments per kg.
4. **Team:** invite staff by email. They receive a link to set their password.

## 7. Move your history across (CSV migration)

1. In your current app, go to **Settings → Export data in CSV**.
2. In the admin, go to **Settings → Import & export → Import from CSV**. Import in this order: **clients, items, quotes, invoices**.
   - Columns are matched automatically from the headings. Check the matches before you import.
   - Quote and invoice files can have one row per line item. Rows sharing a number are combined into one document.
   - Imported documents keep their **original numbers and dates**. They are stored as issued, locked history.
   - Historical "VAT" lines are kept exactly as they were and are not taxed again.
   - If the CSV total differs from the recalculated total, both are kept and a warning is shown.
   - Numbers that already exist are skipped, never overwritten.
3. The number counters move past the highest imported number automatically. You can also set them under **Settings → Numbering**.

## 8. Backups and recovery

- **Supabase Pro** includes daily backups, and point-in-time recovery is available as an add-on. The free plan does **not** include downloadable backups. For business records, use Pro, or at least export everything monthly from **Settings → Import & export → Export** (clients, items, quotes, invoices, payments).
- Issued documents, revisions, stored PDFs, payments and the audit log cannot be edited or deleted, even by an owner using the app or its API.
- To restore into a new project: run both migrations, then restore the data from a Supabase backup.

## 9. Local development and the demo

```bash
npm install          # installs PGlite (dev only; never deployed)
npm test             # 67 tests: maths, numbering, locking, permissions, CSV, endpoints
node server.js       # then open http://localhost:3000/admin/?demo=1
```

The demo runs the real migration inside the browser using PGlite, which is Postgres compiled to WebAssembly. Demo logins are `owner@demo.local` / `demo-owner-pass` and `staff@demo.local` / `demo-staff-pass`. Demo data lives only in that browser tab. The demo cannot run on the deployed site: it refuses any host other than localhost, and PGlite is not deployed.

---

## Business rules built in (change them in Settings, or ask for code changes)

| Area | Rule |
|---|---|
| Money | Stored as whole cents. Rounding is half away from zero, the same in the browser and the database. |
| Line amount | quantity × rate (quantity to 3 decimals) |
| Discount | None, a percentage, or a fixed amount. It never exceeds the subtotal, and it reduces taxable and zero-rated lines in proportion. |
| VAT | *Add VAT* (exclusive), *Prices include VAT* (inclusive) or *No VAT*. 15% by default. VAT on shipping is optional, on by default. |
| Total | Subtotal − discount + shipping + VAT (VAT is only added in exclusive mode) |
| Deposit | None, a percentage of the total, or a fixed amount (capped at the total) |
| Invoice status | Worked out from payments: *Unpaid*, then *Part paid*, then *Paid*. *Overdue* means past the due date with a balance owing. |
| Quote numbers | `QU` + 6 digits, assigned when first saved |
| Invoice numbers | `IN` + 5 digits, assigned when issued, so deleted drafts leave no gaps. Numbers are never reused or duplicated, and allocation is atomic in the database. |
| Issued documents | Locked. Client and company details are frozen as they were on the day of issue. |
| Changing an issued quote | **Revise**: earlier revisions are kept unchanged and the PDF is named `QU000117-R2.pdf`. |
| Changing an issued invoice | Void it with a reason, then **Duplicate** it and issue the corrected copy. |
| Payments | Can't be edited or deleted, only voided with a reason. Overpayment is refused. |
| Internal costing | (material + print hours × (machine + electricity) + labour + design + other) × (1 + failure %) × (1 + overhead %). Owner only. It is never printed and never sent to staff browsers. |
| PDFs | Generated for each issued revision and stored privately. Shared through signed links that expire after 7 days. |
| Roles | **Owner:** everything. **Staff:** clients, items, quotes, invoices and payments, but no costing, profit, reports, settings, team or audit log. |
| Sessions | Kept per browser tab, signed out after 30 idle minutes (configurable). TOTP two-step verification is optional per user and enforced in the database once enrolled. |
