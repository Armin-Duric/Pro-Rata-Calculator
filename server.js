// Local runner (SQLite unless DATABASE_URL is set): node server.js
require('http').createServer(require('./app.js')).listen(process.env.PORT||3000,()=>console.log('http://localhost:'+(process.env.PORT||3000)));
