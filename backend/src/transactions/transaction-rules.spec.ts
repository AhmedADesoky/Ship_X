import { BadRequestException } from '@nestjs/common';
import { validateTxRules } from './transaction-rules';

describe('validateTxRules', () => {
  const inCategory = { kind: 'IN' as const, name: 'إيرادات أخرى', active: true };
  const outCategory = { kind: 'OUT' as const, name: 'كهرباء', active: true };
  const agentParty = { partyType: 'AGENT' as const, active: true };
  const merchantParty = { partyType: 'MERCHANT' as const, active: true };

  it('passes for a matching category with no party', () => {
    expect(() => validateTxRules('IN', inCategory, null)).not.toThrow();
  });

  it('rejects when category kind does not match transaction kind', () => {
    expect(() => validateTxRules('OUT', inCategory, null)).toThrow(BadRequestException);
  });

  it('rejects a category-required-party category with no party (agent case)', () => {
    // partyType drives the requirement now, not the category's display
    // name — this is renamed deliberately vs. the "canonical" name to
    // prove matching no longer depends on it.
    const cat = { kind: 'IN' as const, name: 'وكلاء المحافظات', active: true, partyType: 'AGENT' };
    expect(() => validateTxRules('IN', cat, null)).toThrow(BadRequestException);
    expect(() => validateTxRules('IN', cat, merchantParty)).toThrow(BadRequestException);
    expect(() => validateTxRules('IN', cat, agentParty)).not.toThrow();
  });

  it('rejects a category-required-party category with no party (merchant case)', () => {
    const cat = { kind: 'OUT' as const, name: 'الرواسل', active: true, partyType: 'MERCHANT' };
    expect(() => validateTxRules('OUT', cat, null)).toThrow(BadRequestException);
    expect(() => validateTxRules('OUT', cat, agentParty)).toThrow(BadRequestException);
    expect(() => validateTxRules('OUT', cat, merchantParty)).not.toThrow();
  });

  it('rejects a disallowed party on an unrelated category', () => {
    expect(() => validateTxRules('OUT', outCategory, merchantParty)).toThrow(BadRequestException);
  });

  it('rejects a missing or inactive category', () => {
    expect(() => validateTxRules('IN', null, null)).toThrow(BadRequestException);
    expect(() => validateTxRules('IN', { ...inCategory, active: false }, null)).toThrow(
      BadRequestException,
    );
  });
});
