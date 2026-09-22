import { useState } from 'react';

// Long values (signatures, certificates, embedded QR/PIH) are shortened until expanded.
const LONG_TEXT = 120;
// Collapsed by default: the signature block is large and rarely what people look for.
const COLLAPSED_BY_DEFAULT = new Set(['UBLExtensions']);

const TAG = 'text-[#1d4ed8] dark:text-[#93c5fd]';
const ATTR_NAME = 'text-[#b45309] dark:text-[#fcd34d]';
const ATTR_VALUE = 'text-[#047857] dark:text-[#6ee7b7]';
const PUNCT = 'text-[#64748b] dark:text-gray-500';
const TEXT = 'text-[#0d121b] dark:text-gray-100 font-semibold';

const elementChildren = (node) => Array.from(node.childNodes).filter((c) => c.nodeType === Node.ELEMENT_NODE);
const ownText = (node) =>
  Array.from(node.childNodes)
    .filter((c) => c.nodeType === Node.TEXT_NODE || c.nodeType === Node.CDATA_SECTION_NODE)
    .map((c) => c.nodeValue)
    .join('')
    .trim();

function Attributes({ node }) {
  return Array.from(node.attributes).map((attr) => (
    <span key={attr.name}>
      {' '}
      <span className={ATTR_NAME}>{attr.name}</span>
      <span className={PUNCT}>=&quot;</span>
      <span className={ATTR_VALUE}>{attr.value}</span>
      <span className={PUNCT}>&quot;</span>
    </span>
  ));
}

function OpenTag({ node, selfClosing = false }) {
  return (
    <span>
      <span className={PUNCT}>&lt;</span>
      <span className={TAG}>{node.nodeName}</span>
      <Attributes node={node} />
      <span className={PUNCT}>{selfClosing ? ' />' : '>'}</span>
    </span>
  );
}

function CloseTag({ node }) {
  return (
    <span>
      <span className={PUNCT}>&lt;/</span>
      <span className={TAG}>{node.nodeName}</span>
      <span className={PUNCT}>&gt;</span>
    </span>
  );
}

function TextValue({ text }) {
  const [showAll, _showAll] = useState(false);
  if (text.length <= LONG_TEXT || showAll) return <span className={`${TEXT} break-all`}>{text}</span>;
  return (
    <span>
      <span className={`${TEXT} break-all`}>{text.slice(0, LONG_TEXT)}</span>
      <button
        type="button"
        onClick={() => _showAll(true)}
        className="ml-1 px-1.5 rounded bg-gray-100 dark:bg-gray-800 text-[11px] font-sans text-primary hover:underline"
      >
        … show all {text.length.toLocaleString()} chars
      </button>
    </span>
  );
}

function XmlNode({ node, depth, expandAll }) {
  const children = elementChildren(node);
  const text = ownText(node);
  // The root always starts open so "collapse all" still shows the top-level elements.
  const [open, _open] = useState(depth === 0 || (expandAll ?? !COLLAPSED_BY_DEFAULT.has(node.localName)));
  const indent = { paddingLeft: `${depth * 1.25}rem` };

  if (children.length === 0) {
    return (
      <div style={indent} className="pl-5 leading-6">
        {text ? (
          <span>
            <OpenTag node={node} />
            <TextValue text={text} />
            <CloseTag node={node} />
          </span>
        ) : (
          <OpenTag node={node} selfClosing />
        )}
      </div>
    );
  }

  return (
    <div>
      <div style={indent} className="leading-6 flex items-start">
        <button
          type="button"
          onClick={() => _open((o) => !o)}
          aria-expanded={open}
          aria-label={`${open ? 'Collapse' : 'Expand'} ${node.nodeName}`}
          className="w-5 shrink-0 text-[#4c669a] hover:text-primary font-sans"
        >
          <span aria-hidden="true" className="material-symbols-outlined text-[16px] align-middle">
            {open ? 'expand_more' : 'chevron_right'}
          </span>
        </button>
        <span>
          <OpenTag node={node} />
          {!open && (
            <span>
              <button
                type="button"
                onClick={() => _open(true)}
                className="mx-1 px-1.5 rounded bg-gray-100 dark:bg-gray-800 text-[11px] font-sans text-[#4c669a]"
              >
                {children.length} {children.length === 1 ? 'element' : 'elements'}
              </button>
              <CloseTag node={node} />
            </span>
          )}
        </span>
      </div>
      {open && (
        <>
          {children.map((child, i) => (
            <XmlNode key={i} node={child} depth={depth + 1} expandAll={expandAll} />
          ))}
          <div style={indent} className="pl-5 leading-6">
            <CloseTag node={node} />
          </div>
        </>
      )}
    </div>
  );
}

/**
 * Collapsible, syntax-highlighted view of a parsed XML document.
 * `expandAll` true/false forces every node open/closed; undefined uses the defaults.
 * Remount (change `key`) to apply a new expandAll value.
 */
function XmlTree({ doc, expandAll }) {
  return (
    <div className="font-mono text-[12.5px] overflow-x-auto" data-testid="xml-tree">
      <XmlNode node={doc.documentElement} depth={0} expandAll={expandAll} />
    </div>
  );
}

/** The XML exactly as stored, with line numbers. */
export function XmlSource({ xml }) {
  const lines = xml.split(/\r?\n/);
  return (
    <div className="font-mono text-[12.5px] overflow-x-auto" data-testid="xml-source">
      <table className="border-collapse">
        <tbody>
          {lines.map((line, i) => (
            <tr key={i}>
              <td className="pr-4 text-right align-top select-none text-[#94a3b8] tabular-nums">{i + 1}</td>
              <td className="whitespace-pre text-[#0d121b] dark:text-gray-200">{line}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default XmlTree;
