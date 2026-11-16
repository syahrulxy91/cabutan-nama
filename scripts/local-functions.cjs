// Serve the real callable handler over TCP for environments where the Functions emulator cannot open Unix sockets.
const { createRequire } = require('node:module');
const fromFunctions = createRequire(require.resolve('../functions/package.json'));
const express = fromFunctions('express');

process.env.GCLOUD_PROJECT = 'demo-cabutan-nama';
process.env.FIREBASE_CONFIG = JSON.stringify({ projectId: 'demo-cabutan-nama' });
process.env.FIREBASE_AUTH_EMULATOR_HOST = '127.0.0.1:9099';
process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080';
const { cabutNama } = require('../functions/index.cjs');
const app = express();
app.use(express.json());
app.all('/demo-cabutan-nama/asia-southeast1/cabutNama', cabutNama);
app.listen(5001, '127.0.0.1', () => console.log('Callable HTTP local: http://127.0.0.1:5001'));
