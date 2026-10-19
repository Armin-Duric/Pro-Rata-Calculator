# Lien calculator - Vercel TEST deployment (fake data only)

1. Unzip and push this folder to a new PRIVATE GitHub repo.
2. vercel.com > Add New > Project > import the repo. Framework preset: "Other". Don't deploy yet, or deploy and redeploy after step 3-4.
3. In the project: Storage > Create Database > Postgres (Neon) > connect it to the project. This adds `DATABASE_URL` automatically.
4. Settings > Environment Variables, add for Production (and Preview if you use it):
   - `SESSION_SECRET` = a long random string (required; keep it fixed)
   - `ADMIN_PASSWORD` = a strong password (user `admin`; this value always wins on startup, so changing it and redeploying resets the admin password)
5. Deploy / Redeploy. Open the URL and sign in as `admin`. Tables and 5 email templates are created automatically on first request.

CLI alternative: `npm i -g vercel`, then `vercel`, `vercel env add SESSION_SECRET`, `vercel env add ADMIN_PASSWORD`, `vercel --prod`.

Notes
- Test only: login lockout is per serverless instance, the database SSL check is relaxed, and Vercel's Hobby plan is for non-commercial use. Do NOT enter real patient data (that needs a BAA with Vercel AND with the database provider).
- If the page asks you to sign in to Vercel, turn off Deployment Protection for the project while testing.
- Local run (SQLite, Node 22.5+): `ADMIN_PASSWORD='...' node server.js`.
- Calculator logic, saved cases, reports, admin page and copy-to-clipboard emails are identical to the Azure version.
