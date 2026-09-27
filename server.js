const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const PORT = process.env.PORT || 8420;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.log': 'application/octet-stream',
  '.json': 'application/json',
};

const server = http.createServer((req, res) => {
  let urlPath = decodeURIComponent(req.url.split('?')[0]);
  if (urlPath === '/') urlPath = '/index.html';

  if (urlPath === '/api/logfile') {
    const files = fs.readdirSync(ROOT).filter((f) => f.endsWith('.log'));
    if (files.length === 0) {
      res.writeHead(404);
      res.end('No .log file found in ' + ROOT);
      return;
    }
    const target = path.join(ROOT, files[0]);
    const stat = fs.statSync(target);
    res.writeHead(200, {
      'Content-Type': 'application/octet-stream',
      'Content-Length': stat.size,
      'X-Log-Filename': files[0],
      'X-Log-Mtime': stat.mtime.toISOString(),
    });
    fs.createReadStream(target).pipe(res);
    return;
  }

  const filePath = path.join(ROOT, urlPath);
  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    const ext = path.extname(filePath);
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`360 TraceLog Viewer running on port ${PORT}`);
});
