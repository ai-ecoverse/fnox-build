import { readFileSync } from 'node:fs';
import { request } from 'node:http';
import { connect } from 'node:tls';

const [pauseMs, ...paths] = process.argv.slice(2);
const proxy = new URL(process.env.HTTPS_PROXY);
const ca = readFileSync(process.env.SSL_CERT_FILE);

function get(path) {
  return new Promise((resolve, reject) => {
    const req = request({
      host: proxy.hostname,
      port: proxy.port,
      method: 'CONNECT',
      path: 'localhost:443',
    });
    req.on('error', reject);
    req.on('connect', (res, socket) => {
      if (res.statusCode !== 200) {
        socket.destroy();
        resolve({ status: res.statusCode, body: '' });
        return;
      }
      const tls = connect({ socket, servername: 'localhost', ca });
      let data = '';
      tls.setEncoding('utf8');
      tls.on('secureConnect', () => {
        tls.write(
          `GET ${path} HTTP/1.1\r\nhost: localhost\r\nauthorization: Bearer ${process.env.GH_TOKEN}\r\n\r\n`
        );
      });
      tls.on('data', (chunk) => {
        data += chunk;
      });
      tls.on('error', reject);
      tls.on('end', () => {
        const split = data.indexOf('\r\n\r\n');
        const status = Number(data.slice(0, split).split(' ')[1]);
        resolve({ status, body: data.slice(split + 4) });
      });
    });
    req.end();
  });
}

for (const [index, path] of paths.entries()) {
  if (index > 0) await new Promise((resolve) => setTimeout(resolve, Number(pauseMs)));
  const result = await get(path);
  process.stdout.write(
    `${JSON.stringify({ path, placeholder: process.env.GH_TOKEN, ...result })}\n`
  );
}
