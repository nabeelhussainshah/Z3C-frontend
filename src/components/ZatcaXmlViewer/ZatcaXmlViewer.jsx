// Packages
import { Fragment, useEffect, useMemo, useState } from 'react';
import { useAtomValue } from 'jotai';

// APIs
import { InvoiceZatcaXmlRequest } from '../../requests';

// Utils
import { auth } from '../../atoms';
import { decodeString, showToast } from '../../utils';
import { parseXmlDocument, summarizeInvoiceXml, checkInvoiceXml, formatMinor } from './zatca-xml';
import XmlTree, { XmlSource } from './XmlTree';

const OUTCOMES = {
  passed: { label: 'Passed', className: 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300', icon: 'check_circle' },
  cleared: { label: 'Cleared', className: 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300', icon: 'verified' },
  reported: { label: 'Reported', className: 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300', icon: 'verified' },
  failed: { label: 'Failed', className: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300', icon: 'cancel' },
  rejected: { label: 'Rejected', className: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300', icon: 'cancel' },
  error: { label: 'Error', className: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300', icon: 'error' },
  unknown: { label: 'Unknown', className: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300', icon: 'help' },
};

const MESSAGE_LEVELS = {
  error: { label: 'Errors', className: 'border-red-200 bg-red-50 dark:border-red-900/50 dark:bg-red-900/20', icon: 'error', iconClass: 'text-red-600' },
  warning: { label: 'Warnings', className: 'border-amber-200 bg-amber-50 dark:border-amber-900/50 dark:bg-amber-900/20', icon: 'warning', iconClass: 'text-amber-600' },
  info: { label: 'Info', className: 'border-blue-200 bg-blue-50 dark:border-blue-900/50 dark:bg-blue-900/20', icon: 'info', iconClass: 'text-blue-600' },
};

const CHECK_STATUS = {
  pass: { icon: 'check_circle', className: 'text-green-600' },
  warn: { icon: 'warning', className: 'text-amber-600' },
  fail: { icon: 'cancel', className: 'text-red-600' },
};

function describeSource(doc, invoiceType) {
  if (doc.kind === 'compliance') return 'Validated locally with the ZATCA SDK (Check Compliance). This XML is not sent to ZATCA.';
  if (doc.kind === 'cleared') return 'Returned by ZATCA with its stamp and QR code. This is the cleared invoice.';
  return ['B2B', 'B2G'].includes(invoiceType)
    ? 'Signed XML sent to the ZATCA gateway for clearance.'
    : 'Signed XML reported to the ZATCA gateway.';
}

const formatDateTime = (iso) => (iso ? new Date(iso).toLocaleString() : '—');

// *********** Sections ***********

function OutcomeBadge({ outcome }) {
  const config = OUTCOMES[outcome] ?? OUTCOMES.unknown;
  return (
    <span data-outcome={outcome} className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold ${config.className}`}>
      <span aria-hidden="true" className="material-symbols-outlined text-[14px]">{config.icon}</span>
      {config.label}
    </span>
  );
}

function SectionTitle({ children }) {
  return <h4 className="text-xs font-bold uppercase tracking-wider text-[#4c669a] dark:text-gray-400 mb-3">{children}</h4>;
}

function Messages({ messages }) {
  if (messages.length === 0) return null;
  return (
    <section data-testid="zatca-messages">
      <SectionTitle>Validation messages</SectionTitle>
      <div className="space-y-3">
        {['error', 'warning', 'info'].map((level) => {
          const items = messages.filter((m) => m.level === level);
          if (items.length === 0) return null;
          const config = MESSAGE_LEVELS[level];
          return (
            <div key={level} className={`rounded-lg border p-3 ${config.className}`}>
              <p className="text-xs font-bold text-[#0d121b] dark:text-white mb-2">
                {config.label} ({items.length})
              </p>
              <ul className="space-y-2">
                {items.map((m, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm text-[#0d121b] dark:text-gray-200">
                    <span aria-hidden="true" className={`material-symbols-outlined text-[18px] ${config.iconClass}`}>{config.icon}</span>
                    <span>
                      {m.code && <span className="font-mono font-bold mr-2">{m.code}</span>}
                      {m.category && <span className="text-xs text-[#4c669a] mr-2">[{m.category}]</span>}
                      {m.text}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function Field({ label, value, mono = false }) {
  return (
    <div className="min-w-0">
      <p className="text-[10px] font-bold uppercase text-[#4c669a] dark:text-gray-400">{label}</p>
      <p className={`text-sm text-[#0d121b] dark:text-white break-all ${mono ? 'font-mono' : ''}`}>{value || '—'}</p>
    </div>
  );
}

function Amounts({ summary }) {
  const { totals } = summary;
  const cards = [
    ['Lines', totals.lineExtension],
    ['Allowances', totals.allowanceTotal],
    ['Total without VAT', totals.taxExclusive],
    ['VAT', summary.taxTotal],
    ['Total with VAT', totals.taxInclusive],
    ['Payable', totals.payable],
  ];
  const th = 'px-3 py-2 text-left text-[10px] font-bold uppercase text-[#4c669a] dark:text-gray-400';
  const td = 'px-3 py-2 text-sm text-[#0d121b] dark:text-white';
  const num = `${td} text-right tabular-nums`;

  return (
    <section data-testid="zatca-amounts" className="space-y-4">
      <SectionTitle>What the XML says</SectionTitle>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Field label="Invoice ID" value={summary.id} />
        <Field label="UUID" value={summary.uuid} mono />
        <Field label="ICV" value={summary.icv} />
        <Field label="Issued" value={[summary.issueDate, summary.issueTime].filter(Boolean).join(' ')} />
        <Field label="Type code" value={[summary.typeCode, summary.typeName && `(${summary.typeName})`].filter(Boolean).join(' ')} />
        <Field label="Currency" value={summary.documentCurrency} />
        <Field label="Seller" value={[summary.seller.name, summary.seller.vat].filter(Boolean).join(' · ')} />
        <Field label="Buyer" value={[summary.buyer.name, summary.buyer.vat].filter(Boolean).join(' · ')} />
        {summary.billingReference && <Field label="Billing reference" value={summary.billingReference} />}
      </div>

      <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
        {cards.map(([label, value]) => (
          <div key={label} className="rounded-lg border border-[#e7ebf3] dark:border-[#2a3447] p-3" data-testid={`xml-total-${label}`}>
            <p className="text-[10px] font-bold uppercase text-[#4c669a] dark:text-gray-400">{label}</p>
            <p className="text-base font-bold text-[#0d121b] dark:text-white tabular-nums">{formatMinor(value)}</p>
          </div>
        ))}
      </div>

      <div className="overflow-x-auto rounded-lg border border-[#e7ebf3] dark:border-[#2a3447]">
        <table className="w-full" data-testid="xml-lines">
          <thead className="bg-[#f8f9fc] dark:bg-[#1a253a]">
            <tr>
              <th className={th}>#</th>
              <th className={th}>Item</th>
              <th className={`${th} text-right`}>Qty</th>
              <th className={`${th} text-right`}>Unit price</th>
              <th className={`${th} text-right`}>Discount/unit</th>
              <th className={`${th} text-right`}>Net</th>
              <th className={th}>Tax</th>
              <th className={`${th} text-right`}>VAT</th>
              <th className={`${th} text-right`}>With VAT</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#e7ebf3] dark:divide-[#2a3447]">
            {summary.lines.map((line) => (
              <tr key={line.id}>
                <td className={td}>{line.id}</td>
                <td className={td}>{line.name}</td>
                <td className={num}>{line.quantity}</td>
                <td className={num}>{formatMinor(line.grossPrice)}</td>
                <td className={num}>{line.discount ? formatMinor(line.discount) : '—'}</td>
                <td className={num}>{formatMinor(line.net)}</td>
                <td className={td}>
                  {line.category} {line.percent != null && `${Number(line.percent)}%`}
                </td>
                <td className={num}>{formatMinor(line.vat)}</td>
                <td className={num}>{formatMinor(line.totalWithVat)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="overflow-x-auto rounded-lg border border-[#e7ebf3] dark:border-[#2a3447]">
        <table className="w-full" data-testid="xml-breakdown">
          <thead className="bg-[#f8f9fc] dark:bg-[#1a253a]">
            <tr>
              <th className={th}>VAT category</th>
              <th className={`${th} text-right`}>Rate</th>
              <th className={`${th} text-right`}>Taxable</th>
              <th className={`${th} text-right`}>VAT</th>
              <th className={th}>Exemption</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#e7ebf3] dark:divide-[#2a3447]">
            {summary.breakdown.map((b, i) => (
              <tr key={i}>
                <td className={td}>{b.category}</td>
                <td className={num}>{b.percent != null ? `${Number(b.percent)}%` : '—'}</td>
                <td className={num}>{formatMinor(b.taxable)}</td>
                <td className={num}>{formatMinor(b.tax)}</td>
                <td className={td}>{[b.exemptionCode, b.exemptionReason].filter(Boolean).join(' — ') || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {summary.qr && (
        <div className="rounded-lg border border-[#e7ebf3] dark:border-[#2a3447] p-3" data-testid="xml-qr">
          <p className="text-[10px] font-bold uppercase text-[#4c669a] dark:text-gray-400 mb-2">QR code contents</p>
          <dl className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-1">
            {summary.qr.map((f) => (
              <div key={f.tag} className="flex gap-2 text-sm min-w-0">
                <dt className="text-[#4c669a] shrink-0">
                  {f.tag}. {f.label}:
                </dt>
                <dd className="text-[#0d121b] dark:text-white truncate" title={f.value}>
                  {f.value}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      )}
    </section>
  );
}

function Checks({ checks }) {
  const failing = checks.filter((c) => c.status === 'fail').length;
  const warning = checks.filter((c) => c.status === 'warn').length;
  return (
    <section data-testid="zatca-checks">
      <SectionTitle>
        Checks — {failing === 0 ? 'amounts add up' : `${failing} failing`}
        {warning > 0 && `, ${warning} warning${warning === 1 ? '' : 's'}`}
      </SectionTitle>
      <ul className="divide-y divide-[#e7ebf3] dark:divide-[#2a3447] rounded-lg border border-[#e7ebf3] dark:border-[#2a3447]">
        {checks.map((check) => {
          const config = CHECK_STATUS[check.status];
          return (
            <li key={check.id} data-check={check.id} data-status={check.status} className="flex items-start gap-3 px-3 py-2">
              <span aria-hidden="true" className={`material-symbols-outlined text-[18px] ${config.className}`}>{config.icon}</span>
              <div className="min-w-0">
                <p className="text-sm font-medium text-[#0d121b] dark:text-white">{check.label}</p>
                {check.detail && <p className="text-xs text-[#4c669a] dark:text-gray-400 break-words">{check.detail}</p>}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function XmlPanel({ doc, fileName }) {
  const [mode, _mode] = useState('tree');
  // expandAll: undefined = defaults; bump treeKey to remount with the new setting.
  const [tree, _tree] = useState({ key: 0, expandAll: undefined });
  const parsed = useMemo(() => parseXmlDocument(doc.xml), [doc.xml]);

  const copy = () => {
    navigator.clipboard
      ?.writeText(doc.xml)
      .then(() => showToast('XML copied to clipboard', 'success'))
      .catch(() => showToast('Could not copy the XML', 'error'));
  };

  const download = () => {
    const url = URL.createObjectURL(new Blob([doc.xml], { type: 'application/xml' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    link.click();
    URL.revokeObjectURL(url);
  };

  const btn =
    'inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-[#e7ebf3] dark:border-[#2a3447] bg-white dark:bg-[#161f30] text-xs font-bold text-[#0d121b] dark:text-white hover:bg-gray-50 dark:hover:bg-gray-800';
  const tab = (active) =>
    `px-3 py-1.5 text-xs font-bold rounded-md ${active ? 'bg-white dark:bg-[#161f30] text-primary shadow-sm' : 'text-[#4c669a]'}`;

  return (
    <section>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
        <SectionTitle>XML</SectionTitle>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex rounded-lg bg-[#f0f2f7] dark:bg-[#1a253a] p-0.5">
            <button type="button" className={tab(mode === 'tree')} onClick={() => _mode('tree')} disabled={!parsed.doc}>
              Formatted
            </button>
            <button type="button" className={tab(mode === 'source')} onClick={() => _mode('source')}>
              Source
            </button>
          </div>
          {mode === 'tree' && parsed.doc && (
            <>
              <button type="button" className={btn} onClick={() => _tree((t) => ({ key: t.key + 1, expandAll: true }))}>
                <span aria-hidden="true" className="material-symbols-outlined text-[16px]">unfold_more</span> Expand all
              </button>
              <button type="button" className={btn} onClick={() => _tree((t) => ({ key: t.key + 1, expandAll: false }))}>
                <span aria-hidden="true" className="material-symbols-outlined text-[16px]">unfold_less</span> Collapse all
              </button>
            </>
          )}
          <button type="button" className={btn} onClick={copy}>
            <span aria-hidden="true" className="material-symbols-outlined text-[16px]">content_copy</span> Copy
          </button>
          <button type="button" className={btn} onClick={download}>
            <span aria-hidden="true" className="material-symbols-outlined text-[16px]">download</span> Download
          </button>
        </div>
      </div>
      <div className="rounded-lg border border-[#e7ebf3] dark:border-[#2a3447] bg-[#fbfcfe] dark:bg-[#0f1626] p-3 max-h-[60vh] overflow-auto">
        {mode === 'tree' && parsed.doc ? (
          <XmlTree key={tree.key} doc={parsed.doc} expandAll={tree.expandAll} />
        ) : (
          <XmlSource xml={doc.xml} />
        )}
      </div>
    </section>
  );
}

function DocumentPanel({ doc, view }) {
  const parsed = useMemo(() => parseXmlDocument(doc.xml), [doc.xml]);
  const summary = useMemo(() => (parsed.doc ? summarizeInvoiceXml(parsed.doc) : null), [parsed.doc]);
  const checks = useMemo(() => (summary ? checkInvoiceXml(summary, view.totals?.sar) : []), [summary, view.totals]);
  const isForeign = view.currency && view.currency !== 'SAR';
  const invoiceCurrencyTotal = view.totals?.invoiceCurrency?.grandTotal;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start gap-x-6 gap-y-3">
        <div className="flex items-center gap-2">
          <OutcomeBadge outcome={doc.outcome} />
          <span className="text-xs text-[#4c669a]">{formatDateTime(doc.processedAt)}</span>
        </div>
        <p className="text-sm text-[#0d121b] dark:text-gray-200 flex-1 min-w-[16rem]">{describeSource(doc, view.invoiceType)}</p>
        {doc.stages.length > 0 && (
          <div className="flex flex-wrap gap-1.5" data-testid="sdk-stages">
            {doc.stages.map((s) => (
              <span
                key={s.name}
                className={`px-2 py-0.5 rounded text-[11px] font-bold ${s.result === 'PASSED' ? 'bg-green-50 text-green-700 dark:bg-green-900/30 dark:text-green-300' : 'bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-300'}`}
              >
                {s.name} {s.result}
              </span>
            ))}
          </div>
        )}
      </div>

      {isForeign && (
        <div className="flex items-start gap-2 rounded-lg border border-blue-200 bg-blue-50 dark:border-blue-900/50 dark:bg-blue-900/20 p-3 text-sm text-[#0d121b] dark:text-gray-200">
          <span aria-hidden="true" className="material-symbols-outlined text-[18px] text-blue-600">currency_exchange</span>
          <span>
            This invoice was entered in {view.currency} at {view.exchangeRate} SAR per 1 {view.currency}
            {invoiceCurrencyTotal != null && ` (total ${formatMinor(invoiceCurrencyTotal)} ${view.currency})`}. ZATCA only accepts
            SAR, so every amount in this XML is in SAR.
          </span>
        </div>
      )}

      <Messages messages={doc.messages} />

      {doc.xml ? (
        parsed.error ? (
          <p className="text-sm text-red-600">The XML could not be parsed: {parsed.error}</p>
        ) : (
          <>
            <Amounts summary={summary} />
            <Checks checks={checks} />
            <XmlPanel doc={doc} fileName={`${view.invoiceNumber}-${doc.kind}.xml`} />
          </>
        )
      ) : (
        <p className="text-sm text-[#4c669a]">No XML was stored for this step.</p>
      )}
    </div>
  );
}

// *********** Modal ***********

/**
 * Shows the ZATCA XML of an invoice — compliance check, submitted for
 * clearance/reporting, and cleared by ZATCA — parsed, checked and formatted.
 * Mount it only while open; it loads on mount.
 */
function ZatcaXmlViewer({ invoiceId, invoiceNumber, onClose }) {
  const authValue = useAtomValue(auth);
  const token = useMemo(() => decodeString(authValue), [authValue]);
  const [state, _state] = useState({ status: 'loading', view: null });
  const [activeKind, _activeKind] = useState(null);

  useEffect(() => {
    let cancelled = false;
    InvoiceZatcaXmlRequest(token, invoiceId)
      .then((res) => {
        if (!cancelled) _state({ status: 'ready', view: res?.data ?? null });
      })
      .catch(() => {
        if (!cancelled) _state({ status: 'error', view: null });
      });
    return () => {
      cancelled = true;
    };
  }, [token, invoiceId]);

  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose?.();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const documents = state.view?.documents ?? [];
  // Default to the most advanced step: cleared, then submitted, then compliance.
  const active = documents.find((d) => d.kind === activeKind) ?? documents[documents.length - 1] ?? null;

  return (
    <Fragment>
      <div className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 pointer-events-none">
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="zatca-xml-title"
          className="pointer-events-auto w-full max-w-6xl h-[92vh] flex flex-col rounded-2xl bg-white dark:bg-[#161f30] shadow-2xl border border-[#e7ebf3] dark:border-[#2a3447]"
        >
          <div className="flex items-start justify-between gap-4 px-6 pt-5 pb-4 border-b border-[#e7ebf3] dark:border-[#2a3447]">
            <div>
              <h3 id="zatca-xml-title" className="text-lg font-bold text-[#0d121b] dark:text-white">
                ZATCA XML — {state.view?.invoiceNumber ?? invoiceNumber}
              </h3>
              {state.view && (
                <p className="text-xs text-[#4c669a]">
                  {state.view.invoiceType} · {state.view.status}
                </p>
              )}
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="h-9 w-9 flex items-center justify-center rounded-lg text-[#4c669a] hover:bg-gray-100 dark:hover:bg-gray-800"
            >
              <span aria-hidden="true" className="material-symbols-outlined">close</span>
            </button>
          </div>

          {documents.length > 1 && (
            <div className="px-6 pt-3 flex flex-wrap gap-2 border-b border-[#e7ebf3] dark:border-[#2a3447]" role="tablist">
              {documents.map((d) => (
                <button
                  key={d.kind}
                  type="button"
                  role="tab"
                  aria-selected={active?.kind === d.kind}
                  onClick={() => _activeKind(d.kind)}
                  className={`flex items-center gap-2 px-3 py-2 -mb-px border-b-2 text-sm font-bold ${active?.kind === d.kind ? 'border-primary text-primary' : 'border-transparent text-[#4c669a] hover:text-[#0d121b] dark:hover:text-white'}`}
                >
                  {d.title}
                  <OutcomeBadge outcome={d.outcome} />
                </button>
              ))}
            </div>
          )}

          <div className="flex-1 overflow-y-auto px-6 py-5">
            {state.status === 'loading' && <p className="text-sm text-[#4c669a]">Loading ZATCA XML...</p>}
            {state.status === 'error' && <p className="text-sm text-red-600">The ZATCA XML could not be loaded.</p>}
            {state.status === 'ready' && !active && (
              <p className="text-sm text-[#4c669a]">
                There is no ZATCA XML for this invoice yet. Run Check Compliance or report it to ZATCA to generate one.
              </p>
            )}
            {active && (
              <>
                {documents.length === 1 && <h4 className="text-base font-bold text-[#0d121b] dark:text-white mb-4">{active.title}</h4>}
                <DocumentPanel key={active.kind} doc={active} view={state.view} />
              </>
            )}
          </div>
        </div>
      </div>
    </Fragment>
  );
}

export default ZatcaXmlViewer;
