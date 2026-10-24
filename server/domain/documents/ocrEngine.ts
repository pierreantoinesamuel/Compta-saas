import { createRequire } from 'node:module';
import { copyFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createCanvas } from '@napi-rs/canvas';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import sharp from 'sharp';
import { createWorker, type Worker } from 'tesseract.js';
import type { ExtractedDocumentData, FileFormat } from './documentTypes.js';
import { extractInvoiceFieldsFromText, extractionConfidence } from './ocrTextParser.js';
import { extractWithLlm } from './llmExtractor.js';

const require = createRequire(import.meta.url);
const frenchData = require('@tesseract.js-data/fra') as { code: string; langPath: string; gzip: boolean };
const englishData = require('@tesseract.js-data/eng') as { code: string; langPath: string; gzip: boolean };
const coreDirectory = dirname(require.resolve('tesseract.js-core'));
const localLanguagePath = resolve(tmpdir(), 'haxatax-ocr-languages');
function ensureLocalLanguageData(): void {
  try {
    mkdirSync(localLanguagePath, { recursive: true });
    copyFileSync(resolve(frenchData.langPath, 'fra.traineddata.gz'), resolve(localLanguagePath, 'fra.traineddata.gz'));
    copyFileSync(resolve(englishData.langPath, 'eng.traineddata.gz'), resolve(localLanguagePath, 'eng.traineddata.gz'));
  } catch (err) {
    console.error('[OCR] Failed to copy Tesseract language data to %s:', localLanguagePath, err);
    throw err;
  }
}

let workerPromise: Promise<Worker> | null = null;
function getWorker(): Promise<Worker> {
  if (!workerPromise) {
    workerPromise = (async () => {
      try {
        ensureLocalLanguageData();
        const worker = await createWorker('fra+eng', 1, {
          corePath: coreDirectory,
          langPath: localLanguagePath,
          cacheMethod: 'none',
          logger: message => {
            if (process.env.HAXATAX_OCR_DEBUG === '1') console.log(`[OCR] ${message.status} ${Math.round(message.progress * 100)}%`);
          },
        });
        console.log('[OCR] Tesseract worker initialised (fra+eng)');
        return worker;
      } catch (err) {
        console.error('[OCR] Tesseract worker init failed — will retry on next request:', err);
        workerPromise = null; // allow retry
        throw err;
      }
    })();
  }
  return workerPromise;
}

export async function shutdownOcrEngine(): Promise<void> {
  const runningWorker = workerPromise;
  workerPromise = null;
  if (!runningWorker) return;
  try {
    await (await runningWorker).terminate();
  } catch {
    // A failed initialization has no live worker to clean up.
  }
}

const MAX_PDF_PAGES = 15;
const MIN_SEARCHABLE_TEXT = 35;

async function recognizeImage(bytes: Buffer): Promise<{ text: string; confidence: number }> {
  const normalizedImage = await sharp(bytes, { limitInputPixels: 40_000_000 })
    .rotate()
    .resize({ width: 2400, height: 3200, fit: 'inside', withoutEnlargement: true })
    .png()
    .toBuffer();
  const result = await (await getWorker()).recognize(normalizedImage);
  return { text: result.data.text, confidence: result.data.confidence };
}

async function extractPdfText(bytes: Buffer): Promise<{ text: string; confidence: number; embeddedFacturxXml?: string }> {
  const loadingTask = getDocument({ data: new Uint8Array(bytes), useSystemFonts: true });
  try {
    const pdf = await loadingTask.promise;
    const pageCount = Math.min(pdf.numPages, MAX_PDF_PAGES);
    const pages: string[] = [];
    const confidenceScores: number[] = [];
    const attachments = await pdf.getAttachments();
    const xmlAttachment = attachments
      ? Object.values(attachments).find(attachment => attachment.filename.toLowerCase().endsWith('.xml'))
      : undefined;
    const embeddedFacturxXml = xmlAttachment ? Buffer.from(xmlAttachment.content).toString('utf8') : undefined;

    for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const textContent = await page.getTextContent();
      const positionedItems = textContent.items
        .map(item => 'str' in item && 'transform' in item
          ? { text: item.str.trim(), x: item.transform[4]!, y: item.transform[5]! }
          : null)
        .filter((item): item is { text: string; x: number; y: number } => Boolean(item?.text))
        .sort((a, b) => b.y - a.y || a.x - b.x);
      const rows: Array<{ y: number; items: Array<{ text: string; x: number }> }> = [];
      for (const item of positionedItems) {
        const row = rows.find(candidate => Math.abs(candidate.y - item.y) <= 2);
        if (row) row.items.push(item);
        else rows.push({ y: item.y, items: [item] });
      }
      const searchableText = rows
        .sort((a, b) => b.y - a.y)
        .map(row => row.items.sort((a, b) => a.x - b.x).map(item => item.text).join(' '))
        .join('\n')
        .trim();

      if (searchableText.length >= MIN_SEARCHABLE_TEXT) {
        pages.push(searchableText);
        confidenceScores.push(88);
        continue;
      }

      const viewport = page.getViewport({ scale: 1.7 });
      const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
      const context = canvas.getContext('2d');
      await page.render({ canvas: canvas as unknown as HTMLCanvasElement, canvasContext: context as never, viewport }).promise;
      const ocr = await recognizeImage(canvas.toBuffer('image/png'));
      pages.push(ocr.text);
      confidenceScores.push(ocr.confidence);
    }

    const text = pages.join('\n').trim();
    const confidence = confidenceScores.length
      ? confidenceScores.reduce((sum, value) => sum + value, 0) / confidenceScores.length
      : 0;
    return { text, confidence, embeddedFacturxXml };
  } finally {
    await loadingTask.destroy();
  }
}

export interface OcrDocumentResult {
  text: string;
  confidence: number;
  extractedData: ExtractedDocumentData | null;
  embeddedFacturxXml?: string;
  extractionMethod: 'ocr_llm' | 'ocr_local';
}

export async function extractWithOcr(contentBase64: string, format: FileFormat): Promise<OcrDocumentResult> {
  const bytes = Buffer.from(contentBase64, 'base64');

  if (format === 'pdf') {
    const { text, confidence, embeddedFacturxXml } = await extractPdfText(bytes);
    // LLM text-based extraction: cheaper and more accurate than regex for searchable PDFs
    if (text.length > 50) {
      const llmData = await extractWithLlm({ textContent: text });
      if (llmData) {
        return { text, confidence: 0.92, extractedData: llmData, embeddedFacturxXml, extractionMethod: 'ocr_llm' };
      }
    }
    const extractedData = extractInvoiceFieldsFromText(text);
    return {
      text,
      confidence: extractedData ? extractionConfidence(extractedData, confidence) : Math.min(0.3, confidence / 100),
      extractedData,
      embeddedFacturxXml,
      extractionMethod: 'ocr_local',
    };
  }

  // Image format: try LLM Vision first (faster and more accurate than Tesseract for invoices)
  const llmData = await extractWithLlm({ imageBase64: contentBase64 });
  if (llmData) {
    return { text: '', confidence: 0.92, extractedData: llmData, extractionMethod: 'ocr_llm' };
  }
  // Fall back to Tesseract for text extraction when no LLM key is configured
  const { text, confidence } = await recognizeImage(bytes);
  const extractedData = extractInvoiceFieldsFromText(text);
  return {
    text,
    confidence: extractedData ? extractionConfidence(extractedData, confidence) : Math.min(0.3, confidence / 100),
    extractedData,
    extractionMethod: 'ocr_local',
  };
}
