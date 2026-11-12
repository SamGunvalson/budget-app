import assert from 'node:assert/strict';
import { test } from 'node:test';
import { QueryClient } from '@tanstack/react-query';
import { classifySessionChange, getSessionUserId } from '../src/contexts/authContextValue.js';
import { resetQueryCacheForSessionChange } from '../src/services/queryClient.js';

const sessionFor = (id, token = 't1') => ({ access_token: token, user: { id } });

test('getSessionUserId reads the user id or null', () => {
  assert.equal(getSessionUserId(sessionFor('a')), 'a');
  assert.equal(getSessionUserId(null), null);
  assert.equal(getSessionUserId(undefined), null);
  assert.equal(getSessionUserId({}), null);
});

test('classifySessionChange distinguishes sign-in, sign-out, switch and no-op', () => {
  assert.equal(classifySessionChange(null, 'a'), 'signed-in');
  assert.equal(classifySessionChange(undefined, 'a'), 'signed-in');
  assert.equal(classifySessionChange('a', null), 'signed-out');
  assert.equal(classifySessionChange('a', undefined), 'signed-out');
  assert.equal(classifySessionChange('a', 'b'), 'switched');
  assert.equal(classifySessionChange(null, null), 'none');
  assert.equal(classifySessionChange(undefined, null), 'none');
});

test('a token refresh for the same user is not an identity change', () => {
  const before = getSessionUserId(sessionFor('a', 'old-token'));
  const after = getSessionUserId(sessionFor('a', 'new-token'));
  assert.equal(classifySessionChange(before, after), 'none');
});

const seededClient = () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  client.setQueryData(['transactions', 1, 2026], [{ id: 'tx-user-a' }]);
  client.setQueryData(['accounts'], [{ id: 'acct-user-a' }]);
  return client;
};

test('query cache is kept for same-user and sign-in transitions', () => {
  for (const change of ['none', 'signed-in']) {
    const client = seededClient();
    resetQueryCacheForSessionChange(change, client);
    assert.deepEqual(client.getQueryData(['accounts']), [{ id: 'acct-user-a' }], change);
    assert.equal(client.getQueryCache().getAll().length, 2, change);
  }
});

test('sign-out removes every cached query', () => {
  const client = seededClient();
  resetQueryCacheForSessionChange('signed-out', client);
  assert.equal(client.getQueryCache().getAll().length, 0);
  assert.equal(client.getQueryData(['transactions', 1, 2026]), undefined);
});

test('switching users drops the previous user\'s data from every query', () => {
  const client = seededClient();
  resetQueryCacheForSessionChange('switched', client);
  assert.equal(client.getQueryData(['transactions', 1, 2026]), undefined);
  assert.equal(client.getQueryData(['accounts']), undefined);
});
