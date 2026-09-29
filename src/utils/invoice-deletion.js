/**
 * Invoice deletion rules — mirror the backend's InvoicesService.delete: only a
 * DRAFT that has never been sent to ZATCA can be deleted. A ZATCA-reported
 * invoice (cleared, reported, or rejected at clearance) is part of ZATCA's hash
 * chain, so it must stay.
 */

import { INVOICE_STATUSES } from './constants.js';

// Statuses an invoice only reaches once it has been sent for clearance/reporting.
const REPORTED_STATUSES = [
  'PENDING_CLEARANCE',
  'CLEARANCE_QUEUED',
  'CLEARANCE_PROCESSING',
  'CLEARED',
  'REPORTED',
  'ACCEPTED',
  'FINALIZED',
];

/** Sent to ZATCA for clearance/reporting — accepted or rejected. */
export const hasBeenReportedToZatca = (invoice) =>
  invoice?.clearance != null || invoice?.isClearanceQueued === true || REPORTED_STATUSES.includes(invoice?.status);

export const isInvoiceDeletable = (invoice, canDeleteInvoices) => {
  if (!canDeleteInvoices || !invoice?._id || hasBeenReportedToZatca(invoice)) return false;
  return !!INVOICE_STATUSES.find((status) => status.name === invoice.status)?.canDelete;
};
