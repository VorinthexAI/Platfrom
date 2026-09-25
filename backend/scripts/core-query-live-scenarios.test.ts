import { expect, test } from 'bun:test';
import { LIVE_SCENARIOS } from './core-query-live-scenarios';

test('50-turn live grading handles the observed distinct-count and false-positive edge cases', () => {
  expect(LIVE_SCENARIOS).toHaveLength(50);
  const distinct = LIVE_SCENARIOS[8]!;
  expect(distinct.facts.every((pattern) => pattern.test('There are 3 distinct images saved.'))).toBe(true);
  const attachments = LIVE_SCENARIOS[33]!;
  expect(attachments.contradictions?.some((pattern) => pattern.test('The results did not return a specific attached folder or collection.'))).toBe(true);
  const connectedBook = LIVE_SCENARIOS[46]!;
  expect(connectedBook.facts.every((pattern) => pattern.test('Harbor Ledger and Harbor History describe Pier Seven.'))).toBe(true);
  expect(connectedBook.contradictions?.some((pattern) => pattern.test('No specific book content was identified.'))).toBe(true);
  const multiApp = LIVE_SCENARIOS[49]!;
  expect(multiApp.facts.every((pattern) => pattern.test('City Nights photos, Train Notes and the rail booking email connect Stockholm with a Friday train.'))).toBe(true);
  expect(multiApp.facts.every((pattern) => pattern.test('City Nights photos and Train Notes connect Stockholm with a Friday train.'))).toBe(false);
});
