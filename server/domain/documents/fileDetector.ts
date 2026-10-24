/**
 * File format detection: extension, MIME type, and content sniffing.
 * Routes each upload to the correct parser.
 */

import type { FileFormat } from './documentTypes.js';

const EXT_MAP: Record<string, FileFormat> = {
  '.xml':  'xml_generic',
  '.ofx':  'ofx',
  '.qfx':  'ofx',
  '.pdf':  'pdf',
  '.jpg':  'image',
  '.jpeg': 'image',
  '.png':  'image',
  '.heic': 'image',
  '.tiff': 'image',
  '.tif':  'image',
  '.csv':  'csv',
  '.xlsx': 'excel',
  '.xls':  'excel',
  '.json': 'json',
  '.zip':  'zip',
  '.rar':  'zip',
  '.7z':   'zip',
  '.txt':  'txt',
};

const MIME_MAP: Record<string, FileFormat> = {
  'application/xml':  'xml_generic',
  'text/xml':         'xml_generic',
  'application/pdf':  'pdf',
  'image/jpeg':       'image',
  'image/png':        'image',
  'image/heic':       'image',
  'image/tiff':       'image',
  'text/csv':         'csv',
  'application/csv':  'csv',
  'application/vnd.ms-excel': 'excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'excel',
  'application/json': 'json',
  'application/zip':  'zip',
  'text/plain':       'txt',
};

function getExtension(filename: string): string {
  const dot = filename.lastIndexOf('.');
  return dot >= 0 ? filename.slice(dot).toLowerCase() : '';
}

function sniffXmlSubtype(textContent: string): FileFormat {
  const head = textContent.slice(0, 2000).toLowerCase();
  if (
    head.includes('urn:un:unece:uncefact') ||
    head.includes('rsm:crossindustryinvoice') ||
    head.includes('factur-x') ||
    head.includes('zugferd')
  ) {
    return 'facturx_xml';
  }
  if (
    head.includes('urn:oasis:names:specification:ubl') ||
    head.includes('<invoice ') ||
    head.includes('<creditnote ')
  ) {
    return 'ubl_xml';
  }
  if (
    head.includes('camt.053') ||
    head.includes('camt.054') ||
    head.includes('urn:iso:std:iso:20022') ||
    head.includes('<bktocstmtstmt>') ||
    head.includes('<document ')
  ) {
    return 'camt_xml';
  }
  return 'xml_generic';
}

function isOFX(textContent: string): boolean {
  const head = textContent.slice(0, 500).toUpperCase();
  return head.includes('OFXHEADER') || head.includes('<OFX>') || head.includes('ACCTTYPE');
}

export function detectFileFormat(
  filename: string,
  mimeType: string,
  textContent: string | null
): FileFormat {
  const ext = getExtension(filename);

  // 1. Content sniffing (most reliable)
  if (textContent) {
    if (isOFX(textContent)) return 'ofx';
    const trimmed = textContent.trimStart();
    if (trimmed.startsWith('<?xml') || trimmed.startsWith('<')) {
      return sniffXmlSubtype(textContent);
    }
    if (ext === '.csv' || mimeType.includes('csv')) return 'csv';
  }

  // 2. Extension
  const fromExt = EXT_MAP[ext];
  if (fromExt) return fromExt;

  // 3. MIME
  const baseMime = mimeType.split(';')[0]!.trim().toLowerCase();
  const fromMime = MIME_MAP[baseMime];
  if (fromMime) return fromMime;

  return 'unknown';
}

/** Decode base64 to UTF-8 text. Returns null for binary formats. */
export function tryDecodeAsText(contentBase64: string, format: FileFormat): string | null {
  const binaryFormats: FileFormat[] = ['pdf', 'image', 'excel', 'zip'];
  if (binaryFormats.includes(format)) return null;
  try {
    return Buffer.from(contentBase64, 'base64').toString('utf-8');
  } catch {
    return null;
  }
}
