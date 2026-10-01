import test from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
process.env.COOKIE_SECURE = 'false';
const { refreshCookieOptions } = await import('../src/lib/jwt.js');

function request(protocol, forwardedProtocol = '') {
  return {
    secure: protocol === 'https',
    get(name) {
      return name.toLowerCase() === 'x-forwarded-proto' ? forwardedProtocol : undefined;
    },
  };
}

test('HTTPS refresh cookies are httpOnly and Secure', () => {
  const options = refreshCookieOptions(request('https'));
  assert.equal(options.httpOnly, true);
  assert.equal(options.secure, true);
  assert.equal(options.sameSite, 'lax');
});

test('an explicitly allowed HTTP server receives a non-Secure refresh cookie', () => {
  const options = refreshCookieOptions(request('http'));
  assert.equal(options.httpOnly, true);
  assert.equal(options.secure, false);
  assert.equal(options.sameSite, 'lax');
});

test('TLS terminated by a proxy still produces a Secure cookie', () => {
  const options = refreshCookieOptions(request('http', 'https'));
  assert.equal(options.secure, true);
});
