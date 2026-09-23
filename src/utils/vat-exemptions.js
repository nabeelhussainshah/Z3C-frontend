/**
 * ZATCA VAT exemption helpers for the invoice form. The code list itself comes
 * from the backend (GET /vat-exemption-codes); these rules mirror the backend's
 * validateLineExemptions, with the same messages.
 */

export const OUT_OF_SCOPE_CODE = 'VATEX-SA-OOS';

// ZATCA accepts these only with the buyer's national ID (BR-KSA-49).
const NATIONAL_ID_CODES = ['VATEX-SA-EDU', 'VATEX-SA-HEA'];

const CATEGORY_LABELS = { Z: 'Zero-rated (Z)', E: 'Exempt (E)', O: 'Out of scope (O)' };
const CATEGORY_NAMES = { Z: 'zero-rated', E: 'exempt', O: 'out-of-scope' };

const normalise = (text) => String(text ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
const lines = (numbers) => `line${numbers.length > 1 ? 's' : ''} ${numbers.join(', ')}`;

export const isVatZero = (vat) => vat !== '' && vat !== null && vat !== undefined && Number(vat) === 0;

export const findExemptionCode = (codes, code) => (code ? codes.find((c) => c.code === code) : undefined);

/** Lines saved before codes existed carry only reason text. */
export const matchExemptionCodeByText = (codes, text) =>
  normalise(text) ? codes.find((c) => normalise(c.description) === normalise(text)) : undefined;

export function groupExemptionCodes(codes) {
  return ['Z', 'E', 'O']
    .map((category) => ({
      category,
      label: CATEGORY_LABELS[category],
      codes: codes.filter((c) => c.category === category),
    }))
    .filter((group) => group.codes.length > 0);
}

/** Reason after a code change: pre-filled with the official text unless the user wrote their own. */
export function nextExemptionReason(codes, previousCode, nextCode, currentReason) {
  const previous = findExemptionCode(codes, previousCode);
  const untouched = !String(currentReason ?? '').trim() || (previous && currentReason === previous.description);
  if (!untouched) return currentReason;
  const next = findExemptionCode(codes, nextCode);
  return next && next.code !== OUT_OF_SCOPE_CODE ? next.description : '';
}

/**
 * Validates the exemption fields. `lineItems` carry the effective values
 * (taxExempt forced on at VAT 0%, the resolved code).
 * Returns { lineErrors: { [index]: { taxExemptionCode?, taxExemptReason? } }, messages: string[] }.
 */
export function validateLineExemptions({ lineItems, vat, codes, identificationScheme }) {
  const messages = [];
  const lineErrors = {};
  const addLineError = (index, field, message) => {
    lineErrors[index] = { ...(lineErrors[index] ?? {}), [field]: message };
  };

  if (isVatZero(vat)) {
    const notExempt = lineItems.flatMap((l, i) => (l.taxExempt ? [] : [i + 1]));
    if (notExempt.length > 0) {
      messages.push(
        `VAT is 0%, so every line must be tax exempt with an exemption code and reason (${lines(notExempt)}).`
      );
    }
  }

  const missingCode = [];
  const missingReason = [];
  const codesByCategory = new Map();
  lineItems.forEach((l, i) => {
    if (!l.taxExempt) return;
    const entry = findExemptionCode(codes, l.taxExemptionCode);
    if (!entry) {
      missingCode.push(i + 1);
      addLineError(i, 'taxExemptionCode', 'Select an exemption code');
    } else {
      const list = codesByCategory.get(entry.category) ?? [];
      if (!list.includes(entry.code)) list.push(entry.code);
      codesByCategory.set(entry.category, list);
    }
    if (!String(l.taxExemptReason ?? '').trim()) {
      missingReason.push(i + 1);
      addLineError(i, 'taxExemptReason', 'Enter the exemption reason');
    }
  });

  if (missingCode.length > 0) messages.push(`Select a VAT exemption code for tax-exempt ${lines(missingCode)}.`);
  if (missingReason.length > 0) messages.push(`Enter an exemption reason for tax-exempt ${lines(missingReason)}.`);

  for (const [category, list] of codesByCategory) {
    if (list.length > 1) {
      messages.push(`Use one ${CATEGORY_NAMES[category]} exemption code per invoice (found ${list.join(', ')}).`);
      lineItems.forEach((l, i) => {
        if (l.taxExempt && list.includes(l.taxExemptionCode)) {
          addLineError(i, 'taxExemptionCode', `One ${CATEGORY_NAMES[category]} code per invoice`);
        }
      });
    }
  }

  const needsNationalId = [...codesByCategory.values()].flat().filter((c) => NATIONAL_ID_CODES.includes(c));
  if (needsNationalId.length > 0 && identificationScheme !== 'NAT') {
    messages.push(
      `${needsNationalId.join(' and ')} requires a customer identified by National ID (NAT) (ZATCA BR-KSA-49).`
    );
  }

  return { lineErrors, messages };
}
