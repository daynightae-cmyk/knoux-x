const crypto = require('node:crypto');
const fs = require('node:fs');
const https = require('node:https');
const path = require('node:path');

const selfsigned = require('selfsigned');

const root = path.resolve(process.argv[2] || '');
const configPath = path.resolve(process.argv[3] || '');
if (!root || !configPath) throw new Error('Sprint 02 HTTPS stub requires root and configuration paths.');
fs.mkdirSync(root, { recursive: true });
const attributes = [{ name: 'commonName', value: 'localhost' }];
const generated = selfsigned.generate(attributes, {
  algorithm: 'sha256',
  days: 1,
  keySize: 2048,
  extensions: [{ name: 'subjectAltName', altNames: [
    { type: 2, value: 'localhost' },
    { type: 7, ip: '127.0.0.1' },
  ] }],
});
const caPath = path.join(root, 'sprint-02-stub-ca.pem');
const requestEvidencePath = path.join(root, 'sprint-02-stub-requests.json');
fs.writeFileSync(caPath, generated.cert, { encoding: 'utf8', mode: 0o600 });
const requests = [];

function persist() {
  fs.writeFileSync(requestEvidencePath, `${JSON.stringify({ schemaVersion: 1, requests }, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
}

const server = https.createServer({ key: generated.private, cert: generated.cert }, (request, response) => {
  const chunks = [];
  let bytes = 0;
  request.on('data', (chunk) => {
    bytes += chunk.length;
    if (bytes > 12 * 1024 * 1024) request.destroy(new Error('Stub request too large.'));
    else chunks.push(Buffer.from(chunk));
  });
  request.on('end', () => {
    const body = Buffer.concat(chunks);
    requests.push({
      at: new Date().toISOString(),
      method: request.method,
      url: request.url,
      contentType: request.headers['content-type'] || null,
      contentLength: Number(request.headers['content-length'] || 0),
      bodySha256: crypto.createHash('sha256').update(body).digest('hex'),
      bodyBytes: body.length,
      hasEncodedImagePart: body.includes(Buffer.from('name="encoded_image"')),
      hasKnouxMarker: body.includes(Buffer.from('KNOUX retained capture')),
    });
    persist();
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ url: 'https://lens.google.com/search?p=knoux-synthetic-proof' }));
  });
});

server.listen(0, '127.0.0.1', () => {
  const address = server.address();
  persist();
  fs.writeFileSync(configPath, `${JSON.stringify({ endpoint: `https://127.0.0.1:${address.port}/v3/upload`, caPath, requestEvidencePath, pid: process.pid }, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
});

function shutdown() {
  persist();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 1000).unref();
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
