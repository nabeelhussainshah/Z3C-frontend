/**
 * Pure helpers for reading a ZATCA UBL invoice XML in the browser: parse it,
 * pull out the amounts that matter, and check that they add up (and match
 * the invoice's stored totals and the QR code).
 *
 * The XML is in the invoice currency (DocumentCurrencyCode), with the VAT
 * total repeated in SAR (the TaxTotal without a breakdown). Invoices reported
 * before multi-currency XML carry SAR throughout.
 *
 * All money is handled as integer minor units (cents / halala) to avoid float
 * drift.
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

/**
 * An amount in minor units × an exchange rate (SAR per 1 unit), rounded
 * half-up to the halala in integer arithmetic — the backend's toSarHalala.
 */
export function toSarMinor(minor, exchangeRate) {
  if (minor == null || !(exchangeRate > 0)) return null;
  const rateMicros = BigInt(Math.round(exchangeRate * 1_000_000));
  const abs = BigInt(Math.abs(minor)) * rateMicros;
  const sar = Number((abs + 500_000n) / 1_000_000n);
  return minor < 0 ? -sar : sar;
}

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
  // The TaxTotal carrying the VAT breakdown; the other gives the VAT total in the tax currency, SAR.
  const breakdownTotal = taxTotals.find((t) => kids(t, 'TaxSubtotal').length > 0) ?? taxTotals[0] ?? null;
  const taxCurrencyTotal = taxTotals.find((t) => t !== breakdownTotal) ?? null;
  const monetary = kid(root, 'LegalMonetaryTotal');
  const money = (name) => toMinor(textAt(monetary, name));
  const documentAllowances = kids(root, 'AllowanceCharge');
  const typeCode = kid(root, 'InvoiceTypeCode');

  const currencyIds = Array.from(doc.getElementsByTagName('*'))
    .map((el) => el.getAttribute('currencyID'))
    .filter(Boolean);
  const amountCurrencies = new Set(currencyIds);

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
    currencyIds,
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
    // BT-111: the VAT total in the tax currency (SAR).
    taxCurrencyTotal: taxCurrencyTotal
      ? {
          amount: toMinor(textAt(taxCurrencyTotal, 'TaxAmount')),
          currency: kid(taxCurrencyTotal, 'TaxAmount')?.getAttribute('currencyID') ?? null,
        }
      : null,
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

/** Whether the XML is in a currency other than SAR (amounts in it, VAT also in SAR). */
export const isForeignCurrencyXml = (summary) => !!summary?.documentCurrency && summary.documentCurrency !== 'SAR';

/**
 * Checks that the XML is internally consistent, carries the right currencies,
 * and (when available) matches the invoice's stored totals and its QR code.
 * `stored`: { invoiceCurrency, sar } totals, the invoice's `currency` and
 * `exchangeRate`.
 * An XML in SAR (a SAR invoice, or one reported before multi-currency XML) is
 * checked against the stored SAR totals; a foreign-currency XML against the
 * invoice-currency totals, with its VAT in SAR = VAT × the exchange rate.
 * Each check: { id, label, status: 'pass' | 'fail' | 'warn', detail }.
 */
export function checkInvoiceXml(summary, stored = {}) {
  const { totals, lines, breakdown } = summary;
  const foreign = isForeignCurrencyXml(summary);
  const docCurrency = summary.documentCurrency;
  const checks = [];
  const add = (id, label, failures, { warnOnly = false, passDetail = '' } = {}) =>
    checks.push({
      id,
      label,
      status: failures.length === 0 ? 'pass' : warnOnly ? 'warn' : 'fail',
      detail: failures.length === 0 ? passDetail : failures.join('; '),
    });

  if (foreign) {
    // BR-KSA-CL-02: every amount in BT-5 except the VAT total in SAR (BT-111).
    const issues = [];
    if (summary.taxCurrency !== 'SAR') issues.push(`tax currency is ${summary.taxCurrency ?? 'missing'}, not SAR`);
    const others = summary.currencyIds.filter((c) => c !== docCurrency);
    if (others.length !== 1 || others[0] !== 'SAR' || summary.taxCurrencyTotal?.currency !== 'SAR')
      issues.push(`expected one SAR amount (the VAT total in SAR), found ${others.length ? others.join(', ') : 'none'}`);
    add('currency', `Amounts are in ${docCurrency}, the VAT total also in SAR`, issues, {
      passDetail: `Every amount is ${docCurrency} except the VAT total in SAR; tax currency SAR`,
    });
  } else {
    const nonSar = [summary.documentCurrency, summary.taxCurrency, ...summary.amountCurrencies].filter((c) => c && c !== 'SAR');
    add('currency', 'All amounts are in SAR', nonSar.length ? [`found ${[...new Set(nonSar)].join(', ')}`] : [], {
      passDetail: 'Document, tax and amount currencies are SAR',
    });
  }

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

  if (foreign) {
    const sarVat = summary.taxCurrencyTotal?.amount ?? null;
    const expected = toSarMinor(summary.taxTotal, stored.exchangeRate);
    const issues =
      expected == null
        ? ['no exchange rate stored for this invoice']
        : amountsDiffer(sarVat, expected)
          ? [`SAR VAT ${formatMinor(sarVat)} ≠ ${formatMinor(summary.taxTotal)} × ${stored.exchangeRate} = ${formatMinor(expected)}`]
          : [];
    add('tax-totals', 'VAT total in SAR = VAT × exchange rate', issues, {
      passDetail: `${formatMinor(summary.taxTotal)} ${docCurrency} × ${stored.exchangeRate} = ${formatMinor(sarVat)} SAR`,
    });
  } else {
    const taxTotalsDisagree = summary.taxTotals.some((t) => t !== summary.taxTotal);
    add('tax-totals', 'Both VAT totals agree', taxTotalsDisagree ? [`VAT totals ${summary.taxTotals.map(formatMinor).join(' vs ')}`] : []);
  }

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

  // The stored totals in the XML's currency.
  const storedTotals = foreign ? stored.invoiceCurrency : stored.sar;
  // A foreign invoice whose XML is in SAR was built with the earlier
  // line-by-line SAR conversion; if it was never reported, its stored SAR
  // totals have since been recomputed as amount × rate, so cents may differ.
  const legacySarXml = !foreign && !!stored.currency && stored.currency !== 'SAR';
  if (storedTotals) {
    const issues = [];
    if (amountsDiffer(totals.taxExclusive, storedTotals.subtotal))
      issues.push(pair('total without VAT', totals.taxExclusive, storedTotals.subtotal));
    if (amountsDiffer(summary.taxTotal, storedTotals.vatAmount))
      issues.push(pair('VAT', summary.taxTotal, storedTotals.vatAmount));
    if (amountsDiffer(totals.payable, storedTotals.grandTotal))
      issues.push(pair('payable', totals.payable, storedTotals.grandTotal));
    if (foreign && stored.sar && amountsDiffer(summary.taxCurrencyTotal?.amount, stored.sar.vatAmount))
      issues.push(pair('SAR VAT', summary.taxCurrencyTotal?.amount, stored.sar.vatAmount));
    if (legacySarXml && issues.length)
      issues.push('this XML predates multi-currency XML (line-by-line SAR conversion); the stored SAR totals are now amount × rate');
    add('stored-totals', foreign ? "Matches the invoice's stored totals" : "Matches the invoice's stored SAR totals", issues, {
      warnOnly: legacySarXml,
      passDetail: `${formatMinor(storedTotals.subtotal)} + ${formatMinor(storedTotals.vatAmount)} VAT = ${formatMinor(storedTotals.grandTotal)} ${foreign ? docCurrency : 'SAR'}`,
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
