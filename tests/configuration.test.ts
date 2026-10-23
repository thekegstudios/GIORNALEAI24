import { test, after } from 'node:test';
import assert from 'node:assert/strict';
process.env.DATABASE_PATH = ':memory:';
process.env.AI_DAILY_BUDGET_USD = '0';
const { getSettings } = await import('../src/lib/store');
const { closeDatabase } = await import('../src/lib/db');
after(closeDatabase);
test('a new database respects an explicitly zero AI budget from the server environment', async () => {
  assert.equal((await getSettings()).dailyBudgetUsd, 0);
});
