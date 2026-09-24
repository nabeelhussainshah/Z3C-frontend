import { test, expect } from '@playwright/test';
import { Buffer } from 'node:buffer';
import { mockBackend, signIn, ok, callsTo } from './support/mock-backend';

/**
 * ZATCA XML viewer. The backend is mocked; the XML fixture mirrors what the
 * generator emits for a USD invoice at 3.75 (INV-2026-000018 in dev): four
 * lines, two discounted, one exempt, all amounts in SAR.
 */

// *********** Fixture ***********

/** ZATCA QR payload: base64 TLV with one-byte tag and length. */
function qrTlv(fields) {
  const parts = Object.entries(fields).flatMap(([tag, value]) => {
    const bytes = Buffer.from(value, 'utf8');
    return [Buffer.from([Number(tag), bytes.length]), bytes];
  });
  return Buffer.concat(parts).toString('base64');
}

const LINES = [
  { id: 1, name: 'Cloud hosting', net: '4689.38', vat: '703.41', withVat: '5392.79', cat: 'S', pct: '15' },
  { id: 2, name: 'Support plan', net: '1687.46', vat: '253.12', withVat: '1940.58', cat: 'S', pct: '15', gross: '1874.96', discount: '187.50' },
  { id: 3, name: 'Implementation', net: '3281.25', vat: '492.19', withVat: '3773.44', cat: 'S', pct: '15', gross: '3750.00', discount: '468.75' },
  { id: 4, name: 'Training abroad', net: '1249.99', vat: '0.00', withVat: '1249.99', cat: 'O', pct: '0.00' },
];

function invoiceXml({ payable = '12356.79', qrTotal = '12356.79', qrVat = '1448.71', lines = LINES } = {}) {
  const qr = qrTlv({ 1: 'AVIANTA SERVICES LLC', 2: '399999999900003', 3: '2026-09-22T21:13:33Z', 4: qrTotal, 5: qrVat, 6: 'x'.repeat(44) });
  const line = (l) => `
    <cac:InvoiceLine>
        <cbc:ID>${l.id}</cbc:ID>
        <cbc:InvoicedQuantity unitCode="PCE">${l.qty ?? 1}</cbc:InvoicedQuantity>
        <cbc:LineExtensionAmount currencyID="SAR">${l.net}</cbc:LineExtensionAmount>
        <cac:TaxTotal>
            <cbc:TaxAmount currencyID="SAR">${l.vat}</cbc:TaxAmount>
            <cbc:RoundingAmount currencyID="SAR">${l.withVat}</cbc:RoundingAmount>
        </cac:TaxTotal>
        <cac:Item>
            <cbc:Name>${l.name}</cbc:Name>
            <cac:ClassifiedTaxCategory><cbc:ID>${l.cat}</cbc:ID><cbc:Percent>${l.pct}</cbc:Percent></cac:ClassifiedTaxCategory>
        </cac:Item>
        <cac:Price>
            <cbc:PriceAmount currencyID="SAR">${l.unitNet ?? l.net}</cbc:PriceAmount>
            ${l.discount ? `<cac:AllowanceCharge><cbc:ChargeIndicator>false</cbc:ChargeIndicator><cbc:Amount currencyID="SAR">${l.unitDiscount ?? l.discount}</cbc:Amount><cbc:BaseAmount currencyID="SAR">${l.unitGross ?? l.gross}</cbc:BaseAmount></cac:AllowanceCharge>` : ''}
        </cac:Price>
    </cac:InvoiceLine>`;
  return `<?xml version="1.0" encoding="UTF-8"?>
<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2" xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2" xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2" xmlns:ext="urn:oasis:names:specification:ubl:schema:xsd:CommonExtensionComponents-2">
    <ext:UBLExtensions><ext:UBLExtension><ext:ExtensionContent><SignatureValue>${'S'.repeat(300)}</SignatureValue></ext:ExtensionContent></ext:UBLExtension></ext:UBLExtensions>
    <cbc:ProfileID>reporting:1.0</cbc:ProfileID>
    <cbc:ID>QA-MC-USD</cbc:ID>
    <cbc:UUID>3304aff8-9b71-4022-8791-b11ca682d197</cbc:UUID>
    <cbc:IssueDate>2026-09-22</cbc:IssueDate>
    <cbc:IssueTime>21:13:33Z</cbc:IssueTime>
    <cbc:InvoiceTypeCode name="0100000">388</cbc:InvoiceTypeCode>
    <cbc:DocumentCurrencyCode>SAR</cbc:DocumentCurrencyCode>
    <cbc:TaxCurrencyCode>SAR</cbc:TaxCurrencyCode>
    <cac:AdditionalDocumentReference><cbc:ID>ICV</cbc:ID><cbc:UUID>10</cbc:UUID></cac:AdditionalDocumentReference>
    <cac:AdditionalDocumentReference><cbc:ID>QR</cbc:ID><cac:Attachment><cbc:EmbeddedDocumentBinaryObject mimeCode="text/plain">${qr}</cbc:EmbeddedDocumentBinaryObject></cac:Attachment></cac:AdditionalDocumentReference>
    <cac:AccountingSupplierParty><cac:Party><cac:PartyTaxScheme><cbc:CompanyID>399999999900003</cbc:CompanyID></cac:PartyTaxScheme><cac:PartyLegalEntity><cbc:RegistrationName>AVIANTA SERVICES LLC</cbc:RegistrationName></cac:PartyLegalEntity></cac:Party></cac:AccountingSupplierParty>
    <cac:AccountingCustomerParty><cac:Party><cac:PartyTaxScheme><cbc:CompanyID>311111111100003</cbc:CompanyID></cac:PartyTaxScheme><cac:PartyLegalEntity><cbc:RegistrationName>Al Nakheel Contracting Est.</cbc:RegistrationName></cac:PartyLegalEntity></cac:Party></cac:AccountingCustomerParty>
    <cac:TaxTotal>
        <cbc:TaxAmount currencyID="SAR">1448.71</cbc:TaxAmount>
        <cac:TaxSubtotal>
            <cbc:TaxableAmount currencyID="SAR">9658.09</cbc:TaxableAmount>
            <cbc:TaxAmount currencyID="SAR">1448.71</cbc:TaxAmount>
            <cac:TaxCategory><cbc:ID>S</cbc:ID><cbc:Percent>15</cbc:Percent></cac:TaxCategory>
        </cac:TaxSubtotal>
        <cac:TaxSubtotal>
            <cbc:TaxableAmount currencyID="SAR">1249.99</cbc:TaxableAmount>
            <cbc:TaxAmount currencyID="SAR">0.00</cbc:TaxAmount>
            <cac:TaxCategory><cbc:ID>Z</cbc:ID><cbc:Percent>0.00</cbc:Percent><cbc:TaxExemptionReasonCode>VATEX-SA-33</cbc:TaxExemptionReasonCode><cbc:TaxExemptionReason>Export of services</cbc:TaxExemptionReason></cac:TaxCategory>
        </cac:TaxSubtotal>
    </cac:TaxTotal>
    <cac:TaxTotal><cbc:TaxAmount currencyID="SAR">1448.71</cbc:TaxAmount></cac:TaxTotal>
    <cac:LegalMonetaryTotal>
        <cbc:LineExtensionAmount currencyID="SAR">10908.08</cbc:LineExtensionAmount>
        <cbc:TaxExclusiveAmount currencyID="SAR">10908.08</cbc:TaxExclusiveAmount>
        <cbc:TaxInclusiveAmount currencyID="SAR">12356.79</cbc:TaxInclusiveAmount>
        <cbc:AllowanceTotalAmount currencyID="SAR">0</cbc:AllowanceTotalAmount>
        <cbc:PrepaidAmount currencyID="SAR">0</cbc:PrepaidAmount>
        <cbc:PayableAmount currencyID="SAR">${payable}</cbc:PayableAmount>
    </cac:LegalMonetaryTotal>${lines.map(line).join('')}
</Invoice>`;
}

const COMPLIANCE_DOC = {
  kind: 'compliance',
  title: 'Compliance check',
  source: 'local-sdk',
  outcome: 'passed',
  processedAt: '2026-09-22T21:13:34.302Z',
  xml: invoiceXml(),
  messages: [
    { level: 'warning', code: 'BR-Z-08', text: 'In a VAT breakdown (BG-23) where the VAT category code (BT-118) is "Zero rated" ...' },
    { level: 'warning', code: 'BR-O-01', text: 'An Invoice that contains an Invoice line (BG-25) ... "Not subject to VAT" ...' },
  ],
  stages: [
    { name: 'XSD', result: 'PASSED' },
    { name: 'EN', result: 'PASSED' },
    { name: 'KSA', result: 'PASSED' },
    { name: 'PIH', result: 'PASSED' },
  ],
};
const SUBMITTED_DOC = {
  kind: 'clearance-submitted',
  title: 'Submitted for clearance',
  source: 'zatca',
  outcome: 'cleared',
  processedAt: '2026-09-22T21:14:13.251Z',
  xml: invoiceXml(),
  messages: [{ level: 'info', code: 'XSD_ZATCA_VALID', category: 'XSD validation', text: 'Complied with UBL 2.1 standards in line with ZATCA specifications' }],
  stages: [],
};
const CLEARED_DOC = { ...SUBMITTED_DOC, kind: 'cleared', title: 'Cleared by ZATCA' };

const xmlView = (over = {}) => ({
  invoiceId: 'inv-18',
  invoiceNumber: 'INV-2026-000018',
  invoiceType: 'B2B',
  status: 'CLEARED',
  currency: 'USD',
  exchangeRate: 3.75,
  totals: {
    invoiceCurrency: { subtotal: 290882, discountAmount: 17500, vatAmount: 38632, grandTotal: 329514 },
    sar: { subtotal: 1090808, discountAmount: 65625, vatAmount: 144871, grandTotal: 1235679 },
  },
  documents: [COMPLIANCE_DOC, SUBMITTED_DOC, CLEARED_DOC],
  ...over,
});

const LIST_ROW = {
  _id: 'inv-18',
  invoiceNumber: 'INV-2026-000018',
  referenceNumber: 'QA-MC-USD',
  invoiceType: 'B2B',
  status: 'CLEARED',
  currency: 'USD',
  customerId: { registrationName: 'Al Nakheel Contracting Est.' },
  totalsInCurrency: { grandTotal: 3295.14 },
  createdAt: '2026-09-22T21:13:00.000Z',
  compliance: { invoiceXml: '<Invoice/>' },
  clearance: { invoiceXml: '<Invoice/>' },
};

async function openViewerFromList(page, { view = xmlView(), rows = [LIST_ROW] } = {}) {
  const calls = await mockBackend(page, {
    routes: [
      { method: 'GET', match: (p) => /\/invoices\/[^/]+\/xml$/.test(p), respond: () => ok(view) },
      {
        method: 'GET',
        match: (p) => p.endsWith('/invoices'),
        respond: () => ok({ data: rows, meta: { total: rows.length, page: 1, limit: 10, totalPages: 1 } }),
      },
    ],
  });
  await signIn(page);
  await page.goto('/invoices');
  await page.getByRole('row', { name: /INV-2026-000018/ }).getByRole('combobox').selectOption('view-xml');
  await expect(page.getByRole('dialog', { name: /ZATCA XML/ })).toBeVisible();
  return calls;
}

const dialog = (page) => page.getByRole('dialog', { name: /ZATCA XML/ });
const check = (page, id) => dialog(page).locator(`[data-check="${id}"]`);

// *********** Tests ***********

test.describe('ZATCA XML viewer', () => {
  test('is offered only for invoices that have ZATCA XML, and loads it for that invoice', async ({ page }) => {
    const draft = { ...LIST_ROW, _id: 'inv-draft', invoiceNumber: 'INV-2026-000019', status: 'DRAFT', compliance: null, clearance: null };
    const calls = await openViewerFromList(page, { rows: [LIST_ROW, draft] });

    // (React StrictMode mounts twice in development, so the load can run twice.)
    const xmlCalls = calls.filter((c) => c.path.endsWith('/xml'));
    expect(xmlCalls.length).toBeGreaterThan(0);
    expect(xmlCalls.every((c) => c.path.endsWith('/invoices/inv-18/xml'))).toBe(true);
    const draftOptions = await page.getByRole('row', { name: /INV-2026-000019/ }).getByRole('combobox').locator('option').allTextContents();
    expect(draftOptions).not.toContain('View ZATCA XML');
  });

  test('shows one tab per stored XML, opening on the ZATCA-cleared one', async ({ page }) => {
    await openViewerFromList(page);
    const tabs = dialog(page).getByRole('tab');
    await expect(tabs).toHaveCount(3);
    await expect(dialog(page).getByRole('tab', { name: 'Compliance check Passed' })).toBeVisible();
    await expect(dialog(page).getByRole('tab', { name: 'Submitted for clearance Cleared' })).toBeVisible();
    await expect(dialog(page).getByRole('tab', { name: 'Cleared by ZATCA Cleared' })).toBeVisible();
    await expect(dialog(page).getByRole('tab', { name: /Cleared by ZATCA/ })).toHaveAttribute('aria-selected', 'true');
    await expect(dialog(page).getByText('Returned by ZATCA with its stamp and QR code')).toBeVisible();
    await expect(dialog(page).getByText('XSD_ZATCA_VALID')).toBeVisible();
  });

  test('compliance tab: SDK stages and coded warnings; explains the USD → SAR conversion', async ({ page }) => {
    await openViewerFromList(page);
    await dialog(page).getByRole('tab', { name: /Compliance check/ }).click();

    await expect(dialog(page).getByText('Validated locally with the ZATCA SDK')).toBeVisible();
    await expect(dialog(page).getByTestId('sdk-stages')).toHaveText(/XSD PASSED\s*EN PASSED\s*KSA PASSED\s*PIH PASSED/);
    const messages = dialog(page).getByTestId('zatca-messages');
    await expect(messages).toContainText('Warnings (2)');
    await expect(messages).toContainText('BR-O-01');
    await expect(messages).not.toContainText('Errors');
    await expect(dialog(page).getByText(/entered in USD at 3.75 SAR per 1 USD \(total 3,295.14 USD\)/)).toBeVisible();
  });

  test('summarises the SAR amounts in the XML: totals, lines, VAT breakdown and QR', async ({ page }) => {
    await openViewerFromList(page);
    const amounts = dialog(page).getByTestId('zatca-amounts');

    await expect(amounts.getByTestId('xml-total-Total without VAT')).toContainText('10,908.08');
    await expect(amounts.getByTestId('xml-total-VAT')).toContainText('1,448.71');
    await expect(amounts.getByTestId('xml-total-Payable')).toContainText('12,356.79');

    const rows = amounts.getByTestId('xml-lines').locator('tbody tr');
    await expect(rows).toHaveCount(4);
    // Support plan: gross 1,874.96 − discount 187.50 = net 1,687.46
    await expect(rows.nth(1)).toHaveText(/Support plan.*1,874\.96.*187\.50.*1,687\.46.*S 15%.*253\.12.*1,940\.58/);
    await expect(rows.nth(3)).toHaveText(/Training abroad.*1,249\.99.*O 0%/);

    const breakdown = amounts.getByTestId('xml-breakdown').locator('tbody tr');
    await expect(breakdown.nth(1)).toHaveText(/Z.*1,249\.99.*0\.00.*VATEX-SA-33 — Export of services/);

    const qr = amounts.getByTestId('xml-qr');
    await expect(qr).toContainText('4. Total with VAT:12356.79');
    await expect(qr).toContainText('5. VAT total:1448.71');
  });

  test('checks pass for consistent XML, and flag the exempt line category mismatch as a warning', async ({ page }) => {
    await openViewerFromList(page);

    for (const id of ['currency', 'lines-sum', 'line-vat', 'line-quantity', 'line-price', 'tax-exclusive', 'breakdown-taxable', 'breakdown-tax', 'tax-totals', 'tax-inclusive', 'payable', 'stored-totals', 'qr']) {
      await expect(check(page, id), id).toHaveAttribute('data-status', 'pass');
    }
    await expect(check(page, 'stored-totals')).toContainText('10,908.08 + 1,448.71 VAT = 12,356.79 SAR');
    await expect(check(page, 'categories')).toHaveAttribute('data-status', 'warn');
    await expect(check(page, 'categories')).toContainText('line 4 is category O, the VAT breakdown has S, Z');
    await expect(dialog(page).getByTestId('zatca-checks')).toContainText('Checks — amounts add up, 1 warning');
  });

  test('checks fail when the XML payable disagrees with its totals, the stored SAR totals and the QR', async ({ page }) => {
    const tampered = { ...CLEARED_DOC, xml: invoiceXml({ payable: '12356.80', qrTotal: '12000.00' }) };
    await openViewerFromList(page, { view: xmlView({ documents: [tampered] }) });

    await expect(check(page, 'payable')).toHaveAttribute('data-status', 'fail');
    await expect(check(page, 'payable')).toContainText('payable 12,356.80 ≠ 12,356.79');
    await expect(check(page, 'stored-totals')).toHaveAttribute('data-status', 'fail');
    await expect(check(page, 'stored-totals')).toContainText('payable 12,356.80 ≠ 12,356.79');
    await expect(check(page, 'qr')).toHaveAttribute('data-status', 'fail');
    await expect(check(page, 'qr')).toContainText('QR total 12,000.00 ≠ 12,356.79');
    await expect(check(page, 'lines-sum')).toHaveAttribute('data-status', 'pass');
  });

  test('a rejected clearance shows the submitted XML with ZATCA’s errors', async ({ page }) => {
    const rejected = {
      ...SUBMITTED_DOC,
      outcome: 'rejected',
      messages: [{ level: 'error', code: 'BR-CO-15', category: 'EN_16931', text: 'Invoice total amount with VAT (BT-112)' }],
    };
    await openViewerFromList(page, { view: xmlView({ status: 'REJECTED', currency: 'SAR', exchangeRate: 1, documents: [rejected] }) });

    await expect(dialog(page).getByRole('tab')).toHaveCount(0);
    await expect(dialog(page).getByRole('heading', { name: 'Submitted for clearance' })).toBeVisible();
    await expect(dialog(page).locator('[data-outcome="rejected"]')).toContainText('Rejected');
    await expect(dialog(page).getByTestId('zatca-messages')).toContainText('Errors (1)');
    const error = dialog(page).getByTestId('zatca-messages').getByRole('listitem');
    await expect(error).toContainText('BR-CO-15');
    await expect(error).toContainText('[EN_16931]');
    await expect(error).toContainText('Invoice total amount with VAT (BT-112)');
    await expect(dialog(page).getByText(/entered in/)).toHaveCount(0); // SAR invoice: no conversion note
  });

  test('formatted XML: signature collapsed, long values shortened, expand/collapse all, source view', async ({ page }) => {
    await openViewerFromList(page);
    const tree = dialog(page).getByTestId('xml-tree');

    await expect(tree.getByRole('button', { name: 'Expand ext:UBLExtensions' })).toBeVisible();
    await expect(tree).not.toContainText('SignatureValue');
    await expect(tree).toContainText('cbc:PayableAmount');
    // QR payload (> 120 chars) is shortened
    await expect(tree.getByRole('button', { name: /show all \d+ chars/ })).toBeVisible();

    await dialog(page).getByRole('button', { name: 'Expand all' }).click();
    await expect(tree).toContainText('SignatureValue');
    await tree.getByRole('button', { name: /show all 300 chars/ }).click();
    await expect(tree).toContainText('S'.repeat(300));

    await dialog(page).getByRole('button', { name: 'Collapse all' }).click();
    await expect(tree).not.toContainText('cbc:PayableAmount');
    await expect(tree.getByRole('button', { name: 'Expand cac:LegalMonetaryTotal' })).toBeVisible();

    await dialog(page).getByRole('button', { name: 'Source' }).click();
    const source = dialog(page).getByTestId('xml-source');
    await expect(source).toContainText('<?xml version="1.0" encoding="UTF-8"?>');
    await expect(source.locator('tr').first().locator('td').first()).toHaveText('1');
  });

  test('downloads the XML exactly as stored', async ({ page }) => {
    await openViewerFromList(page);
    const downloadPromise = page.waitForEvent('download');
    await dialog(page).getByRole('button', { name: 'Download' }).click();
    const download = await downloadPromise;

    expect(download.suggestedFilename()).toBe('INV-2026-000018-cleared.xml');
    const chunks = [];
    for await (const chunk of await download.createReadStream()) chunks.push(chunk);
    expect(Buffer.concat(chunks).toString('utf8')).toBe(CLEARED_DOC.xml);
  });

  test('says so when there is no XML yet, and closes with Escape', async ({ page }) => {
    await openViewerFromList(page, { view: xmlView({ status: 'DRAFT', documents: [] }) });
    await expect(dialog(page).getByText('There is no ZATCA XML for this invoice yet')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialog(page)).toHaveCount(0);
  });

  test('is available from the invoice form actions of a saved invoice', async ({ page }) => {
    const calls = await mockBackend(page, {
      routes: [
        { method: 'GET', match: (p) => p.endsWith('/invoices/inv-18/xml'), respond: () => ok(xmlView()) },
        {
          method: 'GET',
          match: (p) => p.endsWith('/invoices/inv-18'),
          respond: () =>
            ok({
              ...LIST_ROW,
              paymentType: 'CASH',
              paymentTerms: 'Net 30',
              vat: 15,
              exchangeRate: 3.75,
              customerId: { _id: 'cust-1', registrationName: 'Al Nakheel Contracting Est.', customerVAT: '311111111100003' },
              lineItems: [{ description: 'Cloud hosting', productCode: 'CH-1', quantity: 1, price: 125050, discount_amount: 0, total: 125050 }],
            }),
        },
        {
          method: 'GET',
          match: (p) => p.endsWith('/currencies'),
          respond: () => ok([{ code: 'SAR', name: 'Saudi Riyal' }, { code: 'USD', name: 'US Dollar' }]),
        },
      ],
    });
    await signIn(page);
    await page.goto('/invoices/inv-18');
    await expect(page.getByPlaceholder('Description of product...')).toHaveValue('Cloud hosting');

    await page.getByText('Actions', { exact: true }).click({ force: true });
    await page.getByText('View ZATCA XML', { exact: true }).click();
    await expect(dialog(page)).toContainText('ZATCA XML — INV-2026-000018');
    expect(callsTo(calls, 'GET', '/invoices/inv-18/xml').length).toBeGreaterThan(0);
  });

  test('a line with quantity 3: per-unit prices shown, quantity × net unit price checked', async ({ page }) => {
    // Implementation: 3 × (1,250.00 − 156.25) = 3 × 1,093.75 = 3,281.25 (same line amount as the fixture)
    const qtyLines = LINES.map((l) => (l.id === 3 ? { ...l, qty: 3, unitGross: '1250.00', unitDiscount: '156.25', unitNet: '1093.75' } : l));
    await openViewerFromList(page, { view: xmlView({ documents: [{ ...CLEARED_DOC, xml: invoiceXml({ lines: qtyLines }) }] }) });

    const rows = dialog(page).getByTestId('xml-lines').locator('tbody tr');
    await expect(rows.nth(2)).toHaveText(/Implementation.*3.*1,250\.00.*156\.25.*3,281\.25/);
    await expect(check(page, 'line-quantity')).toHaveAttribute('data-status', 'pass');
    await expect(check(page, 'line-price')).toHaveAttribute('data-status', 'pass');
    await expect(dialog(page).getByRole('columnheader', { name: 'Discount/unit' })).toBeVisible();
  });

  test('flags a line whose amount is not quantity × net unit price', async ({ page }) => {
    const wrong = LINES.map((l) => (l.id === 3 ? { ...l, qty: 3, unitGross: '1250.00', unitDiscount: '156.25', unitNet: '1000.00' } : l));
    await openViewerFromList(page, { view: xmlView({ documents: [{ ...CLEARED_DOC, xml: invoiceXml({ lines: wrong }) }] }) });

    await expect(check(page, 'line-quantity')).toHaveAttribute('data-status', 'fail');
    await expect(check(page, 'line-quantity')).toContainText('line 3: 3 × 1,000.00 = 3,000.00 ≠ 3,281.25');
    await expect(check(page, 'line-price')).toHaveAttribute('data-status', 'fail');
    await expect(check(page, 'line-price')).toContainText('line 3: 1,250.00 − 156.25 ≠ 1,000.00');
  });
});
