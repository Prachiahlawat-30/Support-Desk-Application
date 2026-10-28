import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ANALYSIS_LIMITS } from '../../src/domain/copilot.js';
import { validateAnalysis } from '../../src/validation/copilotValidation.js';

const valid = {
  summary: 'Customer was charged twice for the March invoice.',
  category: 'Payment',
  subcategory: 'Duplicate Charge',
  sentiment: 'frustrated',
  suggestedPriority: 'High',
  recommendedAction: 'Check the payment provider for two captures and refund the duplicate.',
  reasoning: 'Money was taken twice, so the customer is directly affected.',
};

describe('validateAnalysis', () => {
  it('accepts a valid analysis, trims text and drops unknown properties', () => {
    const { value, errors } = validateAnalysis({ ...valid, summary: `  ${valid.summary}  `, extra: 'ignored' });
    assert.equal(errors, null);
    assert.deepEqual(value, valid);
  });

  it('rejects an unsupported category', () => {
    const { value, errors } = validateAnalysis({ ...valid, category: 'Refunds' });
    assert.equal(value, null);
    assert.deepEqual(Object.keys(errors), ['category']);
  });

  it('rejects an unsupported sentiment, including wrong case', () => {
    assert.deepEqual(Object.keys(validateAnalysis({ ...valid, sentiment: 'furious' }).errors), ['sentiment']);
    assert.deepEqual(Object.keys(validateAnalysis({ ...valid, sentiment: 'Angry' }).errors), ['sentiment']);
  });

  it('rejects an invalid priority', () => {
    assert.deepEqual(Object.keys(validateAnalysis({ ...valid, suggestedPriority: 'Critical' }).errors), ['suggestedPriority']);
    assert.deepEqual(Object.keys(validateAnalysis({ ...valid, suggestedPriority: 'high' }).errors), ['suggestedPriority']);
  });

  it('rejects missing, empty, non-string and over-long text fields', () => {
    const { errors } = validateAnalysis({
      ...valid,
      summary: '   ',
      subcategory: 42,
      recommendedAction: undefined,
      reasoning: 'x'.repeat(ANALYSIS_LIMITS.reasoning + 1),
    });
    assert.deepEqual(Object.keys(errors).sort(), ['reasoning', 'recommendedAction', 'subcategory', 'summary']);
  });

  it('rejects values that are not objects', () => {
    for (const input of [null, 'text', [valid], 3]) assert.ok(validateAnalysis(input).errors.body);
  });
});
