import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../', import.meta.url);
async function source(path) {
  return readFile(new URL(path, root), 'utf8');
}

test('login links to signup and homepage', async () => {
  const login = await source('src/app/login/page.tsx');
  assert.match(login, /href=.{0,20}signup/);
  assert.match(login, /href="\/"/);
  assert.match(login, /credentials:'include'/);
  assert.doesNotMatch(login, /sessionStorage|localStorage|Authorization/);
});

test('signup calls account registration with cookie authentication', async () => {
  const signup = await source('src/app/signup/page.tsx');
  assert.match(signup, /\/auth\/register/);
  assert.match(signup, /credentials:'include'/);
  assert.match(signup, /location\.href='\/\?welcome=1'/);
  assert.match(signup, /getSafeReturnTo/);
  assert.doesNotMatch(signup, /setReturnTo\('\/dashboard'\)/);
  assert.match(signup, /\bname\b/);
  assert.match(signup, /\bemail\b/);
  assert.match(signup, /\bpassword\b/);
  assert.match(signup, /\bphone\b/);
  assert.doesNotMatch(signup, /sessionStorage|localStorage|Authorization/);
});

test('package registration redirects unauthenticated users with return destination', async () => {
  const registration = await source('src/app/register/page.tsx');
  assert.match(registration, /\/auth\/me/);
  assert.match(registration, /\/login\?returnTo=/);
  assert.match(registration, /credentials:'include'/);
  assert.doesNotMatch(registration, /sessionStorage|localStorage|Authorization/);
});

test('homepage navigation and dashboard are auth-aware', async () => {
  const homepage = await source('src/app/page.tsx');
  assert.match(homepage, /href="\/login"/);
  assert.match(homepage, /href="\/signup"/);
  assert.match(homepage, /href="\/dashboard"/);
  assert.match(homepage, /Register now/);
  assert.match(homepage, /\/auth\/me/);
  assert.match(homepage, /credentials:'include'/);
  assert.match(homepage, /Welcome to BATTLE MILES! Your account is ready\./);
});

test('login normal and registration return destinations are resolved safely', async () => {
  const { getSafeReturnTo } = await import('./lib/authRedirect.mjs');
  assert.equal(getSafeReturnTo(null, '/'), '/');
  assert.equal(getSafeReturnTo('/dashboard', '/'), '/dashboard');
  assert.equal(getSafeReturnTo('/register?distance=10', '/'), '/register?distance=10');
  assert.equal(getSafeReturnTo('https://evil.example/register', '/'), '/');
  assert.equal(getSafeReturnTo('//evil.example/register', '/'), '/');
  assert.equal(getSafeReturnTo('/%2f%2fevil.example/register', '/'), '/');
  assert.equal(getSafeReturnTo('/register\\u0000evil', '/'), '/');
  assert.equal(getSafeReturnTo('javascript:alert(1)', '/'), '/');
});

test('login and protected registration use matching returnTo parameter', async () => {
  const login = await source('src/app/login/page.tsx');
  const registration = await source('src/app/register/page.tsx');
  assert.match(login, /params\.get\('returnTo'\)/);
  assert.match(login, /getSafeReturnTo/);
  assert.match(registration, /\/login\?returnTo=/);
  assert.doesNotMatch(login, /location\.href=\/?['"]?\/register/);
});
