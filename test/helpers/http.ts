import http from 'node:http';

export interface HttpResult {
  status: number;
  body: Buffer;
  headers: http.IncomingHttpHeaders;
}

export interface HttpOptions {
  port: number;
  method: string;
  path: string;
  /** The Host header selects the dynamic vhost (tenant), independent of the connection. */
  hostHeader: string;
  auth?: { user: string; pass: string };
  body?: string | Buffer;
}

/**
 * A minimal HTTP client over node:http. Used instead of fetch so the Host
 * header can be set explicitly to drive Apache's mod_vhost_alias docroot.
 */
export function httpRequest(options: HttpOptions): Promise<HttpResult> {
  return new Promise((resolve, reject) => {
    const headers: Record<string, string> = { Host: options.hostHeader };
    if (options.auth) {
      const token = Buffer.from(
        `${options.auth.user}:${options.auth.pass}`,
      ).toString('base64');
      headers.Authorization = `Basic ${token}`;
    }
    const body =
      options.body === undefined ? undefined : Buffer.from(options.body);
    if (body) {
      headers['Content-Length'] = String(body.length);
    }

    const req = http.request(
      {
        host: '127.0.0.1',
        port: options.port,
        method: options.method,
        path: options.path,
        headers,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => {
          resolve({
            status: res.statusCode ?? 0,
            body: Buffer.concat(chunks),
            headers: res.headers,
          });
        });
      },
    );
    req.on('error', reject);
    if (body) {
      req.write(body);
    }
    req.end();
  });
}
