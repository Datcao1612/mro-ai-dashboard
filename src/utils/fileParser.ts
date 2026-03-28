import * as pdfjsLib from 'pdfjs-dist';
import * as XLSX from 'xlsx';

// Initialize PDF.js worker using unpkg (CDN) to avoid Vite bundling issues with workers
pdfjsLib.GlobalWorkerOptions.workerSrc = `//unpkg.com/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.mjs`;

/**
 * Extract text from a File object (PDF or XLSX)
 */
export async function extractTextFromFile(file: File): Promise<string> {
  const extension = file.name.split('.').pop()?.toLowerCase();
  
  if (extension === 'pdf') {
    return parsePDF(file);
  } else if (['xlsx', 'xls', 'csv'].includes(extension || '')) {
    return parseExcel(file);
  } else {
    throw new Error('Định dạng file không được hỗ trợ. Vui lòng chọn PDF hoặc Excel.');
  }
}

async function parsePDF(file: File): Promise<string> {
  const arrayBuffer = await file.arrayBuffer();
  const pdfFile = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  
  let fullText = '';
  // Limit to maximum 10 pages to avoid blowing up the token count
  const maxPages = Math.min(pdfFile.numPages, 10);
  
  for (let i = 1; i <= maxPages; i++) {
    const page = await pdfFile.getPage(i);
    const textContent = await page.getTextContent();
    const pageText = textContent.items
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .map((item: any) => item.str || '')
      .join(' ');
    fullText += `--- Page ${i} ---\n${pageText}\n\n`;
  }
  
  return fullText;
}

async function parseExcel(file: File): Promise<string> {
  const arrayBuffer = await file.arrayBuffer();
  const workbook = XLSX.read(arrayBuffer, { type: 'array' });
  
  let fullText = '';
  // Process the first sheet only, or map through all if needed.
  // MRO data is usually on the primary active sheet.
  const sheetName = workbook.SheetNames[0];
  const worksheet = workbook.Sheets[sheetName];
  
  // Convert sheet to CSV for compact, readable string representation for AI
  const csvText = XLSX.utils.sheet_to_csv(worksheet, { strip: true, skipHidden: true });
  fullText += `--- Sheet: ${sheetName} ---\n${csvText}\n\n`;
  
  return fullText;
}
