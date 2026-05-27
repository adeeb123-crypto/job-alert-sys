export interface ProxyConfig {
  server: string;
  username: string;
  password: string;
}

export function getProxyConfig(_domain?: string): ProxyConfig | null {
  const host = process.env.PROXY_HOST;
  const port = process.env.PROXY_PORT;
  const user = process.env.PROXY_USER;
  const pass = process.env.PROXY_PASS;

  if (!host || !port || !user || !pass) return null;

  // SmartProxy port 10000 is a rotating endpoint — base username only
  return {
    server: `http://${host}:${port}`,
    username: user,
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

  // Test 2: returns correct config shape when vars present
  process.env.PROXY_HOST = 'gate.smartproxy.com';
  process.env.PROXY_PORT = '10000';
  process.env.PROXY_USER = 'testuser';
  process.env.PROXY_PASS = 'testpass';

  const cfg = getProxyConfig('bayt.com');
  console.assert(cfg !== null, 'FAIL: Should return config when vars set');
  console.assert(cfg!.server === 'http://gate.smartproxy.com:10000', `FAIL: Wrong server: ${cfg!.server}`);
  console.assert(cfg!.username === 'testuser', `FAIL: Username should be base user: ${cfg!.username}`);
  console.assert(cfg!.password === 'testpass', 'FAIL: Wrong password');
  console.log('PASS: config shape correct');

  // Test 3: domain argument is ignored (rotating endpoint, no session suffix)
  const cfg2 = getProxyConfig('indeed.com');
  console.assert(cfg!.username === cfg2!.username, 'FAIL: Username should be same regardless of domain');
  console.log('PASS: domain argument ignored — base username used');

  // Test 4: isProxyConfigured returns true
  console.assert(isProxyConfigured() === true, 'FAIL: isProxyConfigured should be true');
  console.log('PASS: isProxyConfigured returns true when vars set');

  console.log('\nAll proxyManager tests passed.');
}
