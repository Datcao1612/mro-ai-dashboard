/**
 * Extract text from a File object (PDF or XLSX/XLS/CSV).
 *
 * Heavy libraries (pdfjs-dist, xlsx) are dynamically imported so they are
 * NOT included in the initial JS bundle — they are only downloaded when the
 * user actually uploads a file. This is the main driver of the bundle-size
 * reduction from ~1.3 MB → ~200 KB initial load.
 */
export async function extractTextFromFile(file: File): Promise<string> {
  // ── File-size guard ────────────────────────────────────────────────────────
  if (file.size > 20 * 1024 * 1024) {
    throw new Error('File vượt quá 20 MB. Vui lòng chọn file nhỏ hơn.');
  }

  const extension = file.name.split('.').pop()?.toLowerCase();

  if (extension === 'pdf') {
    return parsePDF(file);
  } else if (['xlsx', 'xls', 'csv'].includes(extension ?? '')) {
    return parseExcel(file);
  } else {
    throw new Error('Định dạng file không được hỗ trợ. Vui lòng chọn PDF hoặc Excel.');
  }
}

// ── PDF ───────────────────────────────────────────────────────────────────────

async function parsePDF(file: File): Promise<string> {
  // Dynamic import — pdfjs-dist (~3 MB) is only fetched when user uploads a PDF
  const pdfjsLib = await import('pdfjs-dist');

  // new URL() tells Vite to copy the worker into the build output automatically
  // so the app works offline without relying on an external CDN (unpkg).
  pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
    'pdfjs-dist/build/pdf.worker.min.mjs',
    import.meta.url,
  ).href;

  const arrayBuffer = await file.arrayBuffer();
  const pdfFile = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;

  let fullText = '';
  // Cap at 10 pages to keep token count reasonable
  const maxPages = Math.min(pdfFile.numPages, 10);

  for (let i = 1; i <= maxPages; i++) {
    const page = await pdfFile.getPage(i);
    const textContent = await page.getTextContent();
    const pageText = (textContent.items as Array<{ str?: string }>)
      .map((item) => item.str ?? '')
      .join(' ');
    fullText += `--- Page ${i} ---\n${pageText}\n\n`;
  }

  return fullText;
}

// ── Excel / CSV ───────────────────────────────────────────────────────────────

async function parseExcel(file: File): Promise<string> {
  // Dynamic import — xlsx (~1 MB) is only fetched when user uploads a spreadsheet
  const XLSX = await import('xlsx');

  const arrayBuffer = await file.arrayBuffer();
  const workbook = XLSX.read(arrayBuffer, { type: 'array' });

  let fullText = '';
  // MRO data is usually on the primary active sheet
  const sheetName = workbook.SheetNames[0];
  const worksheet = workbook.Sheets[sheetName];

  // CSV is the most compact, readable format for AI input
  const csvText = XLSX.utils.sheet_to_csv(worksheet, { strip: true, skipHidden: true });
  fullText += `--- Sheet: ${sheetName} ---\n${csvText}\n\n`;

  return fullText;
}
