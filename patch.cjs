const fs = require('fs');
const path = require('path');
let content = fs.readFileSync(path.join(__dirname, 'api', 'index.ts'), 'utf-8');

const regex = /async function requestWithProxy[\s\S]*?async function fetchWithProxy/m;
const replacement = `async function requestWithProxy(targetUrl: string, options: { headers?: Record<string, string>; timeout?: number; isBinary?: boolean } = {}): Promise<{ status: number; headers: any; body: any }> {
  try {
    const headers = {
      "User-Agent": options.headers?.["User-Agent"] || "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      ...options.headers,
    };
    
    const response = await got(targetUrl, {
      headers,
      timeout: {
        request: options.timeout || 12000
      },
      retry: {
        limit: 1
      },
      followRedirect: true,
      responseType: options.isBinary ? 'buffer' : 'text',
      https: {
        rejectUnauthorized: false
      }
    }) as any;

    return {
      status: response.statusCode,
      headers: response.headers,
      body: response.body
    };
  } catch (err: any) {
    throw err;
  }
}

async function fetchWithProxy`;

content = content.replace(regex, replacement);
fs.writeFileSync(path.join(__dirname, 'api', 'index.ts'), content, 'utf-8');
