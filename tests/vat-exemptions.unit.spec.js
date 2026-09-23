import { test, expect } from '@playwright/test';
import {
  OUT_OF_SCOPE_CODE,
  isVatZero,
  groupExemptionCodes,
  matchExemptionCodeByText,
  nextExemptionReason,
  validateLineExemptions,
} from '../src/utils/vat-exemptions.js';

/** Pure helpers of the invoice form (no browser page needed). */

const CODES = [
  { code: 'VATEX-SA-29', category: 'E', description: 'Financial services mentioned in Article 29 of the VAT Regulations' },
  { code: 'VATEX-SA-32', category: 'Z', description: 'Export of goods' },
  { code: 'VATEX-SA-33', category: 'Z', description: 'Export of services' },
  { code: 'VATEX-SA-35', category: 'Z', description: 'Medicines and medical equipment' },
  { code: 'VATEX-SA-EDU', category: 'Z', description: 'Private education to citizen' },
  { code: 'VATEX-SA-OOS', category: 'O', description: 'Services outside scope of tax / Not subject to VAT' },
];
const std = { taxExempt: false };
const ex = (code, reason = 'reason') => ({ taxExempt: true, taxExemptionCode: code, taxExemptReason: reason });
const validate = (lineItems, vat = 15, identificationScheme = '') =>
  validateLineExemptions({ lineItems, vat, codes: CODES, identificationScheme });

test.describe('VAT exemption helpers', () => {
  test('VAT counts as zero only for a real 0', () => {
    expect([isVatZero(0), isVatZero('0'), isVatZero(''), isVatZero(15), isVatZero(null)]).toEqual([true, true, false, false, false]);
  });

  test('groups codes as zero-rated, exempt, out of scope', () => {
    expect(groupExemptionCodes(CODES).map((g) => [g.label, g.codes.map((c) => c.code)])).toEqual([
      ['Zero-rated (Z)', ['VATEX-SA-32', 'VATEX-SA-33', 'VATEX-SA-35', 'VATEX-SA-EDU']],
      ['Exempt (E)', ['VATEX-SA-29']],
      ['Out of scope (O)', ['VATEX-SA-OOS']],
    ]);
  });

  test('matches a saved reason to its code ignoring case and spaces', () => {
    expect(matchExemptionCodeByText(CODES, ' export  OF goods')?.code).toBe('VATEX-SA-32');
    expect(matchExemptionCodeByText(CODES, 'Something else')).toBeUndefined();
    expect(matchExemptionCodeByText(CODES, '')).toBeUndefined();
  });

  test('pre-fills the reason with the official text unless the user wrote their own', () => {
    expect(nextExemptionReason(CODES, '', 'VATEX-SA-33', '')).toBe('Export of services');
    expect(nextExemptionReason(CODES, 'VATEX-SA-33', 'VATEX-SA-35', 'Export of services')).toBe('Medicines and medical equipment');
    expect(nextExemptionReason(CODES, 'VATEX-SA-33', 'VATEX-SA-35', 'Consulting abroad')).toBe('Consulting abroad');
    expect(nextExemptionReason(CODES, 'VATEX-SA-33', OUT_OF_SCOPE_CODE, 'Export of services')).toBe('');
  });

  test('validation messages match the backend', () => {
    expect(validate([std, ex('VATEX-SA-33', 'Export of services')]).messages).toEqual([]);
    expect(validate([ex(''), ex('VATEX-SA-32', ' ')]).messages).toEqual([
      'Select a VAT exemption code for tax-exempt line 1.',
      'Enter an exemption reason for tax-exempt line 2.',
    ]);
    expect(validate([std, ex('VATEX-SA-32'), std], 0).messages).toEqual([
      'VAT is 0%, so every line must be tax exempt with an exemption code and reason (lines 1, 3).',
    ]);
    expect(validate([ex('VATEX-SA-32'), ex('VATEX-SA-33')]).messages).toEqual([
      'Use one zero-rated exemption code per invoice (found VATEX-SA-32, VATEX-SA-33).',
    ]);
    expect(validate([ex('VATEX-SA-EDU')], 15, 'CRN').messages).toEqual([
      'VATEX-SA-EDU requires a customer identified by National ID (NAT) (ZATCA BR-KSA-49).',
    ]);
    expect(validate([ex('VATEX-SA-EDU')], 15, 'NAT').messages).toEqual([]);
  });

  test('flags the fields to highlight on each line', () => {
    expect(validate([ex(''), ex('VATEX-SA-32', '')]).lineErrors).toEqual({
      0: { taxExemptionCode: 'Select an exemption code' },
      1: { taxExemptReason: 'Enter the exemption reason' },
    });
    expect(validate([ex('VATEX-SA-32'), ex('VATEX-SA-33')]).lineErrors).toEqual({
      0: { taxExemptionCode: 'One zero-rated code per invoice' },
      1: { taxExemptionCode: 'One zero-rated code per invoice' },
    });
  });
});
