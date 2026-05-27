import * as crypto from 'crypto';

export interface ProxyConfig {
  server: string;
  username: string;
  password: string;
}

function domainSessionId(domain: string): string {
  return crypto.createHash('md5').update(domain).digest('hex').slice(0, 8);
}

export function getProxyConfig(domain?: string): ProxyConfig | null {
  const host = process.env.PROXY_HOST;
  const port = process.env.PROXY_PORT;
  const user = process.env.PROXY_USER;
  const pass = process.env.PROXY_PASS;

  if (!host || !port || !user || !pass) return null;

  const username = domain ? `${user}-session-${domainSessionId(domain)}` : user;

  return {
    server: `http://${host}:${port}`,
    username,
    password: pass,
  };
}

export function isProxyConfigured(): boolean {
  return !!(
    process.env.PROXY_HOST &&
    process.env.PROXY_PORT &&
    process.env.PROXY_USER &&
    process.env.PROXY_PASS
  );
}

if (require.main === module) {
  // Test 1: returns null when env vars missing
  delete process.env.PROXY_HOST;
  delete process.env.PROXY_PORT;
  delete process.env.PROXY_USER;
  delete process.env.PROXY_PASS;

  console.assert(getProxyConfig() === null, 'FAIL: Should return null when not configured');
  console.assert(isProxyConfigured() === false, 'FAIL: isProxyConfigured should be false');
  console.log('PASS: returns null when proxy env vars missing');

  // Test 2: returns config with sticky session when vars present
  process.env.PROXY_HOST = 'gate.smartproxy.com';
  process.env.PROXY_PORT = '10000';
  process.env.PROXY_USER = 'testuser';
  process.env.PROXY_PASS = 'testpass';

  const cfg = getProxyConfig('bayt.com');
  console.assert(cfg !== null, 'FAIL: Should return config when vars set');
  console.assert(cfg!.server === 'http://gate.smartproxy.com:10000', `FAIL: Wrong server: ${cfg!.server}`);
  console.assert(cfg!.username.startsWith('testuser-session-'), `FAIL: Missing session: ${cfg!.username}`);
  console.assert(cfg!.password === 'testpass', 'FAIL: Wrong password');
  console.log('PASS: config shape correct with sticky session');

  // Test 3: same domain → same session ID (sticky)
  const cfg2 = getProxyConfig('bayt.com');
  console.assert(cfg!.username === cfg2!.username, 'FAIL: Same domain must yield same session ID');
  console.log('PASS: same domain → same session ID');

  // Test 4: different domains → different session IDs
  const cfg3 = getProxyConfig('indeed.com');
  console.assert(cfg!.username !== cfg3!.username, 'FAIL: Different domains must yield different session IDs');
  console.log('PASS: different domains → different session IDs');

  // Test 5: no domain → username without session suffix
  const cfg4 = getProxyConfig();
  console.assert(cfg4!.username === 'testuser', `FAIL: No domain should not append session: ${cfg4!.username}`);
  console.log('PASS: no domain → plain username');

  console.log('\nAll proxyManager tests passed.');
}
