# Lien calculator

## Run locally
Node 22.5+ (uses built-in SQLite, no packages to install):
`ADMIN_PASSWORD='a-long-password' node server.js` then open http://localhost:3000 and sign in as `admin`.
Forgot the admin password? Stop the server and run `node server.js --reset-admin "NewPassword123"`.

## Deploy to Azure App Service (Linux)
Needs Azure CLI (`az login`). Pick a US region and a globally unique app name.
```
az group create -n lien-rg -l centralus
az appservice plan create -g lien-rg -n lien-plan --is-linux --sku B1
az webapp create -g lien-rg -p lien-plan -n YOUR-APP-NAME --runtime "NODE:22-lts"
az webapp config appsettings set -g lien-rg -n YOUR-APP-NAME --settings SESSION_SECRET="<long random string>" ADMIN_PASSWORD="<strong password>" DATA_DIR=/home/data
az webapp config set -g lien-rg -n YOUR-APP-NAME --startup-file "node server.js" --always-on true
az webapp update -g lien-rg -n YOUR-APP-NAME --https-only true
az webapp deploy -g lien-rg -n YOUR-APP-NAME --src-path lien-app.zip --type zip
```
Open https://YOUR-APP-NAME.azurewebsites.net and sign in as `admin`.
- The zip already has the files at its root, which Azure requires. Do not re-zip a parent folder.
- Run on exactly ONE instance (SQLite is a single file). Data lives in /home/data, which persists across restarts and deploys.
- Check the runtime is Node 22.5+ (`az webapp list-runtimes --os linux`, or SSH in and run `node --version`).
- Keep SESSION_SECRET fixed; changing it logs everyone out.
- Back up /home/data/liens.db regularly (Kudu: https://YOUR-APP-NAME.scm.azurewebsites.net).
- Before real patient data: BAA with Microsoft, Azure Database for PostgreSQL instead of SQLite, Entra ID sign-in with MFA, security review.
