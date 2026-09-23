import test from 'node:test';
import assert from 'node:assert/strict';
import { connectedViews } from './config';
import { makeDemoDataset } from './demo';

test('Telegram hides unconnected views even from older saved selections', () => {
  const dataset = makeDemoDataset('telegram');
  dataset.events = dataset.events.filter(event => event.surface === 'telegram' && event.name !== 'page_viewed');
  dataset.capabilities.payments = false;
  dataset.capabilities.sessions = false;
  assert.deepEqual(connectedViews(dataset, 'overview', ['visitors','revenue','conversion','revenue_per_visitor','bounce','session_time','pageviews','pages_per_visitor','activation','trend']), ['visitors','activation','trend']);
  assert.deepEqual(connectedViews(dataset, 'pages', ['hostname','page']), []);
  dataset.capabilities.payments = true;
  assert.deepEqual(connectedViews(dataset, 'overview', ['visitors','revenue']), ['visitors','revenue']);
  dataset.product.profile = 'saas';
  assert.deepEqual(connectedViews(dataset, 'pages', ['page']), ['page']);
});
