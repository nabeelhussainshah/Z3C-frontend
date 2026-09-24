/**
 * Pure helpers for reading a ZATCA UBL invoice XML in the browser: parse it,
 * pull out the amounts that matter, and check that they add up (and match
 * the invoice's stored SAR totals and the QR code).
 *
 * All money is handled as integer minor units (halala) to avoid float drift.
 */

// *********** Parsing ***********

export function parseXmlDocument(xml) {
  if (!xml) return { doc: null, error: 'No XML stored for this document.' };
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  const parserError = doc.getElementsByTagName('parsererror')[0];
  if (parserError) {
    return { doc: null, error: parserError.textContent.trim().split('\n')[0] || 'The XML could not be parsed.' };
  }
  return { doc, error: null };
}

// UBL elements are namespaced (cbc:, cac:, ext:); match on local names.
const kids = (el, name) => (el ? Array.from(el.children).filter((c) => c.localName === name) : []);
const kid = (el, name) => kids(el, name)[0] ?? null;
const at = (el, ...names) => names.reduce((cur, name) => kid(cur, name), el);
const textAt = (el, ...names) => {
  const node = at(el, ...names);
  return node ? node.textContent.trim() : null;
};

/** "1234.5" → 123450. Rounds half-up past 2 decimals; null when not a number. */
export function toMinor(value) {
  if (value == null) return null;
  const m = /^(-)?(\d+)(?:\.(\d*))?$/.exec(String(value).trim());
  if (!m) return null;
  const frac = (m[3] ?? '').padEnd(3, '0');
  let minor = Number(m[2]) * 100 + Number(frac.slice(0, 2));
  if (Number(frac[2]) >= 5) minor += 1;
  return m[1] ? -minor : minor;
}

const sum = (values) => values.reduce((acc, v) => acc + (v ?? 0), 0);

export function formatMinor(minor) {
  if (minor == null) return '—';
  return (minor / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// *********** QR (TLV) ***********

const QR_TAGS = {
  1: 'Seller name',
  2: 'VAT number',
  3: 'Timestamp',
  4: 'Total with VAT',
  5: 'VAT total',
  6: 'Invoice hash',
  7: 'Signature',
  8: 'Public key',
  9: 'Certificate signature',
};

/** Decodes the ZATCA QR payload (base64 TLV). Returns null if it is not valid TLV. */
export function decodeQrTlv(base64) {
  if (!base64) return null;
  try {
    const binary = atob(base64.replace(/\s+/g, ''));
    const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
    const decoder = new TextDecoder();
    const fields = [];
    let i = 0;
    while (i < bytes.length) {
      const tag = bytes[i];
      const length = bytes[i + 1];
      if (length === undefined || i + 2 + length > bytes.length) return null;
      const value = bytes.slice(i + 2, i + 2 + length);
      fields.push({
        tag,
        label: QR_TAGS[tag] ?? `Tag ${tag}`,
        // Tags 8 and 9 are raw binary (key / signature bytes).
        value: tag >= 8 ? `${length} bytes` : decoder.decode(value),
      });
      i += 2 + length;
    }
    return fields.length > 0 ? fields : null;
  } catch {
    return null;
  }
}

// *********** Summary ***********

function readLine(line) {
  const priceAllowance = kids(at(line, 'Price'), 'AllowanceCharge').find(
    (ac) => textAt(ac, 'ChargeIndicator') === 'false'
  );
  const net = toMinor(textAt(line, 'LineExtensionAmount'));
  const price = toMinor(textAt(line, 'Price', 'PriceAmount'));
  const discount = toMinor(textAt(priceAllowance, 'Amount')) ?? 0;
  return {
    id: textAt(line, 'ID'),
    name: textAt(line, 'Item', 'Name'),
    quantity: textAt(line, 'InvoicedQuantity'),
    // PriceAmount is the net unit price; BaseAmount (when present) is the gross.
    grossPrice: toMinor(textAt(priceAllowance, 'BaseAmount')) ?? price,
    discount,
    netPrice: price,
    net,
    vat: toMinor(textAt(line, 'TaxTotal', 'TaxAmount')),
    totalWithVat: toMinor(textAt(line, 'TaxTotal', 'RoundingAmount')),
    category: textAt(line, 'Item', 'ClassifiedTaxCategory', 'ID'),
    percent: textAt(line, 'Item', 'ClassifiedTaxCategory', 'Percent'),
  };
}

export function summarizeInvoiceXml(doc) {
  const root = doc.documentElement;
  const refs = kids(root, 'AdditionalDocumentReference');
  const ref = (id) => refs.find((r) => textAt(r, 'ID') === id) ?? null;
  const taxTotals = kids(root, 'TaxTotal');
  // The TaxTotal carrying the VAT breakdown; the other repeats the amount in the tax currency.
  const breakdownTotal = taxTotals.find((t) => kids(t, 'TaxSubtotal').length > 0) ?? taxTotals[0] ?? null;
  const monetary = kid(root, 'LegalMonetaryTotal');
  const money = (name) => toMinor(textAt(monetary, name));
  const documentAllowances = kids(root, 'AllowanceCharge');
  const typeCode = kid(root, 'InvoiceTypeCode');

  const amountCurrencies = new Set(
    Array.from(doc.getElementsByTagName('*'))
      .map((el) => el.getAttribute('currencyID'))
      .filter(Boolean)
  );

  return {
    id: textAt(root, 'ID'),
    uuid: textAt(root, 'UUID'),
    issueDate: textAt(root, 'IssueDate'),
    issueTime: textAt(root, 'IssueTime'),
    typeCode: typeCode?.textContent.trim() ?? null,
    typeName: typeCode?.getAttribute('name') ?? null,
    documentCurrency: textAt(root, 'DocumentCurrencyCode'),
    taxCurrency: textAt(root, 'TaxCurrencyCode'),
    amountCurrencies: [...amountCurrencies],
    icv: textAt(ref('ICV'), 'UUID'),
    billingReference: textAt(root, 'BillingReference', 'InvoiceDocumentReference', 'ID'),
    seller: {
      name: textAt(root, 'AccountingSupplierParty', 'Party', 'PartyLegalEntity', 'RegistrationName'),
      vat: textAt(root, 'AccountingSupplierParty', 'Party', 'PartyTaxScheme', 'CompanyID'),
    },
    buyer: {
      name: textAt(root, 'AccountingCustomerParty', 'Party', 'PartyLegalEntity', 'RegistrationName'),
      vat: textAt(root, 'AccountingCustomerParty', 'Party', 'PartyTaxScheme', 'CompanyID'),
    },
    lines: kids(root, 'InvoiceLine').map(readLine),
    breakdown: kids(breakdownTotal, 'TaxSubtotal').map((st) => ({
      category: textAt(st, 'TaxCategory', 'ID'),
      percent: textAt(st, 'TaxCategory', 'Percent'),
      taxable: toMinor(textAt(st, 'TaxableAmount')),
      tax: toMinor(textAt(st, 'TaxAmount')),
      exemptionCode: textAt(st, 'TaxCategory', 'TaxExemptionReasonCode'),
      exemptionReason: textAt(st, 'TaxCategory', 'TaxExemptionReason'),
    })),
    taxTotal: toMinor(textAt(breakdownTotal, 'TaxAmount')),
    taxTotals: taxTotals.map((t) => toMinor(textAt(t, 'TaxAmount'))),
    documentAllowanceTotal: sum(
      documentAllowances.filter((ac) => textAt(ac, 'ChargeIndicator') === 'false').map((ac) => toMinor(textAt(ac, 'Amount')))
    ),
    totals: {
      lineExtension: money('LineExtensionAmount'),
      allowanceTotal: money('AllowanceTotalAmount') ?? 0,
      chargeTotal: money('ChargeTotalAmount') ?? 0,
      taxExclusive: money('TaxExclusiveAmount'),
      taxInclusive: money('TaxInclusiveAmount'),
      prepaid: money('PrepaidAmount') ?? 0,
      payableRounding: money('PayableRoundingAmount') ?? 0,
      payable: money('PayableAmount'),
    },
    qr: decodeQrTlv(textAt(ref('QR'), 'Attachment', 'EmbeddedDocumentBinaryObject')),
  };
}

// *********** Consistency checks ***********

const amountsDiffer = (a, b) => a == null || b == null || a !== b;
const pair = (label, actual, expected) => `${label} ${formatMinor(actual)} ≠ ${formatMinor(expected)}`;

/**
 * Checks that the XML is internally consistent, carries SAR, and (when
 * available) matches the invoice's stored SAR totals and its QR code.
 * Each check: { id, label, status: 'pass' | 'fail' | 'warn', detail }.
 */
export function checkInvoiceXml(summary, storedSarTotals) {
  const { totals, lines, breakdown } = summary;
  const checks = [];
  const add = (id, label, failures, { warnOnly = false, passDetail = '' } = {}) =>
    checks.push({
      id,
      label,
      status: failures.length === 0 ? 'pass' : warnOnly ? 'warn' : 'fail',
      detail: failures.length === 0 ? passDetail : failures.join('; '),
    });

  const nonSar = [summary.documentCurrency, summary.taxCurrency, ...summary.amountCurrencies].filter((c) => c && c !== 'SAR');
  add('currency', 'All amounts are in SAR', nonSar.length ? [`found ${[...new Set(nonSar)].join(', ')}`] : [], {
    passDetail: 'Document, tax and amount currencies are SAR',
  });

  const linesNet = sum(lines.map((l) => l.net));
  add('lines-sum', 'Line amounts add up to the line total', amountsDiffer(linesNet, totals.lineExtension)
    ? [pair('Σ lines', linesNet, totals.lineExtension)]
    : [], { passDetail: `${lines.length} line(s) = ${formatMinor(linesNet)}` });

  const lineVatIssues = lines
    .filter((l) => l.totalWithVat != null && amountsDiffer((l.net ?? 0) + (l.vat ?? 0), l.totalWithVat))
    .map((l) => `line ${l.id}: ${formatMinor(l.net)} + ${formatMinor(l.vat)} ≠ ${formatMinor(l.totalWithVat)}`);
  add('line-vat', 'Each line: net + VAT = line total with VAT', lineVatIssues);

  // BR-KSA-EN16931-11: line amount = quantity × net unit price (ZATCA allows ±0.01).
  const lineQuantityIssues = lines
    .filter((l) => {
      const qty = Number(l.quantity);
      return l.net == null || l.netPrice == null || !Number.isFinite(qty) || Math.abs(Math.round(qty * l.netPrice) - l.net) > 1;
    })
    .map((l) => `line ${l.id}: ${l.quantity} × ${formatMinor(l.netPrice)} = ${formatMinor(Math.round(Number(l.quantity) * (l.netPrice ?? 0)))} ≠ ${formatMinor(l.net)}`);
  add('line-quantity', 'Each line: quantity × net unit price = line amount', lineQuantityIssues);

  // The price discount is per unit: unit price − unit discount = net unit price.
  const linePriceIssues = lines
    .filter((l) => l.discount && amountsDiffer(l.grossPrice - l.discount, l.netPrice))
    .map((l) => `line ${l.id}: ${formatMinor(l.grossPrice)} − ${formatMinor(l.discount)} ≠ ${formatMinor(l.netPrice)}`);
  add('line-price', 'Each line: unit price − unit discount = net unit price', linePriceIssues);

  const expectedTaxExclusive = (totals.lineExtension ?? 0) - totals.allowanceTotal + totals.chargeTotal;
  add('tax-exclusive', 'Total without VAT = lines − allowances + charges', amountsDiffer(expectedTaxExclusive, totals.taxExclusive)
    ? [pair('tax exclusive', totals.taxExclusive, expectedTaxExclusive)]
    : []);

  const taxable = sum(breakdown.map((b) => b.taxable));
  add('breakdown-taxable', 'VAT breakdown taxable amounts = total without VAT', amountsDiffer(taxable, totals.taxExclusive)
    ? [pair('Σ taxable', taxable, totals.taxExclusive)]
    : []);

  const breakdownTax = sum(breakdown.map((b) => b.tax));
  add('breakdown-tax', 'VAT breakdown amounts = VAT total', amountsDiffer(breakdownTax, summary.taxTotal)
    ? [pair('Σ VAT', breakdownTax, summary.taxTotal)]
    : []);

  const taxTotalsDisagree = summary.taxTotals.some((t) => t !== summary.taxTotal);
  add('tax-totals', 'Both VAT totals agree', taxTotalsDisagree ? [`VAT totals ${summary.taxTotals.map(formatMinor).join(' vs ')}`] : []);

  const expectedInclusive = (totals.taxExclusive ?? 0) + (summary.taxTotal ?? 0);
  add('tax-inclusive', 'Total with VAT = total without VAT + VAT', amountsDiffer(expectedInclusive, totals.taxInclusive)
    ? [pair('tax inclusive', totals.taxInclusive, expectedInclusive)]
    : []);

  const expectedPayable = (totals.taxInclusive ?? 0) - totals.prepaid + totals.payableRounding;
  add('payable', 'Payable = total with VAT − prepaid + rounding', amountsDiffer(expectedPayable, totals.payable)
    ? [pair('payable', totals.payable, expectedPayable)]
    : []);

  const breakdownCategories = new Set(breakdown.map((b) => b.category));
  const categoryIssues = lines
    .filter((l) => l.category && !breakdownCategories.has(l.category))
    .map((l) => `line ${l.id} is category ${l.category}, the VAT breakdown has ${[...breakdownCategories].join(', ') || 'none'}`);
  add('categories', 'Every line tax category is in the VAT breakdown', categoryIssues, { warnOnly: true });

  if (storedSarTotals) {
    const issues = [];
    if (amountsDiffer(totals.taxExclusive, storedSarTotals.subtotal))
      issues.push(pair('total without VAT', totals.taxExclusive, storedSarTotals.subtotal));
    if (amountsDiffer(summary.taxTotal, storedSarTotals.vatAmount))
      issues.push(pair('VAT', summary.taxTotal, storedSarTotals.vatAmount));
    if (amountsDiffer(totals.payable, storedSarTotals.grandTotal))
      issues.push(pair('payable', totals.payable, storedSarTotals.grandTotal));
    add('stored-totals', "Matches the invoice's stored SAR totals", issues, {
      passDetail: `${formatMinor(storedSarTotals.subtotal)} + ${formatMinor(storedSarTotals.vatAmount)} VAT = ${formatMinor(storedSarTotals.grandTotal)} SAR`,
    });
  }

  if (summary.qr) {
    const qrAmount = (tag) => toMinor(summary.qr.find((f) => f.tag === tag)?.value);
    const issues = [];
    if (amountsDiffer(qrAmount(4), totals.taxInclusive)) issues.push(pair('QR total', qrAmount(4), totals.taxInclusive));
    if (amountsDiffer(qrAmount(5), summary.taxTotal)) issues.push(pair('QR VAT', qrAmount(5), summary.taxTotal));
    add('qr', 'QR code totals match the XML', issues);
  }

  return checks;
}
