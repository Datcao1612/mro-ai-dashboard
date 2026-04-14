import { useState } from 'react';
import { extractTextFromFile } from './utils/fileParser';
import { analyzeMROData } from './utils/aiClient';
import type { MROAnalysisResult, MROItem } from './utils/aiClient';
import { UploadCloud, CheckCircle2, Clock, AlertTriangle, FileText, Loader2, Download, Sparkles } from 'lucide-react';
import * as XLSX from 'xlsx';
function App() {
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<MROAnalysisResult | null>(null);
  const [isReevaluating, setIsReevaluating] = useState(false);

  const handleCellChange = (index: number, field: keyof MROItem, value: string) => {
    if (!results) return;
    const newTable = [...results.table];
    newTable[index] = { ...newTable[index], [field]: value };
    
    if (field === 'quantity' || field === 'unitPrice') {
       const qtyStr = String(newTable[index].quantity || '');
       const costStr = String(newTable[index].unitPrice || '');
       const qty = parseFloat(qtyStr.replace(/,/g, '')) || 0;
       const cost = parseFloat(costStr.replace(/,/g, '')) || 0;
       if (qty > 0 && cost > 0) {
           newTable[index].totalAmount = String(qty * cost);
       }
    }
    
    setResults({ ...results, table: newTable });
  };

  const handleReevaluate = async () => {
    if (!results) return;
    setIsReevaluating(true);
    setError(null);
    try {
      const headers = ['STT', 'Mã PR', 'Mô Tả Vật Tư', 'ĐVT', 'Số Lượng', 'Đơn Giá', 'Thành Tiền', 'Ngày Đề Xuất', 'Ngày Dự Kiến', 'Ngày Thực Tế', 'Trạng Thái'];
      const csvRows = results.table.map(row => 
         [
            row.stt, 
            `"${(String(row.prNo || '')).replace(/"/g, '""')}"`,
            `"${(String(row.description || '')).replace(/"/g, '""')}"`,
            `"${(String(row.unit || '')).replace(/"/g, '""')}"`,
            `"${(String(row.quantity || '')).replace(/"/g, '""')}"`,
            `"${(String(row.unitPrice || '')).replace(/"/g, '""')}"`,
            `"${(String(row.totalAmount || '')).replace(/"/g, '""')}"`,
            `"${(String(row.proposalDate || '')).replace(/"/g, '""')}"`,
            `"${(String(row.expectedDate || '')).replace(/"/g, '""')}"`,
            `"${(String(row.actualDate || '')).replace(/"/g, '""')}"`,
            `"${(String(row.status || '')).replace(/"/g, '""')}"`
         ].join(',')
      );
      const csvString = [headers.join(','), ...csvRows].join('\n');
      const payload = `--- BÁO CÁO MRO DÙNG ĐỂ ĐÁNH GIÁ LẠI ---\n\n` + csvString;
      
      const analysis = await analyzeMROData(payload);
      setResults(analysis);
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : 'Có lỗi trong quá trình Đánh giá lại dữ liệu.');
    } finally {
      setIsReevaluating(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFile(e.dataTransfer.files[0]);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      handleFile(e.target.files[0]);
    }
  };

  const handleFile = async (selectedFile: File) => {
    setFile(selectedFile);
    setLoading(true);
    setError(null);
    setResults(null);

    try {
      // 1. Parse File
      const rawText = await extractTextFromFile(selectedFile);
      // 2. Call AI
      const analysis = await analyzeMROData(rawText);
      setResults(analysis);
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : 'Có lỗi xảy ra trong quá trình trích xuất.');
    } finally {
      setLoading(false);
    }
  };

  const formatCurrency = (val: string | undefined | number) => {
    if (!val || val === '-' || val === 0) return '-';
    const str = String(val).trim();
    return str.replace(/\d{4,}/g, (match) => {
      return match.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    });
  };

  const parsedDeliveryReport = results ? (results.summary.deliveryReport || [])
    .flatMap(report => report.split('\n'))
    .map(r => r.replace(/^-\s*/, '').trim())
    .filter(r => r.length > 0) : [];

  const parsedDelayedItems = results ? results.table
    .filter(row => row.isDelayed)
    .map(row => row.description || "Vật tư không tên")
    .filter(desc => desc.trim().length > 0) : [];

  const exportToExcel = () => {
    if (!results) return;

    // 1. Create Summary Worksheet (Báo Cáo Tổng Quan)
    const summaryData = [
      ["BÁO CÁO NHANH & ĐÁNH GIÁ TIẾN ĐỘ"],
      [""],
      ["Tình hình chung:", `Hệ thống ghi nhận tổng cộng ${results.summary.total} đơn hàng. Đã về: ${results.summary.completed} (${results.summary.completedPercentage}). Chưa về: ${results.summary.pending} (${results.summary.pendingPercentage}).`],
    ];

    if (results.summary.totalValue) {
      summaryData.push(["Tổng giá trị:", formatCurrency(results.summary.totalValue)]);
    }

    summaryData.push([""]);
    summaryData.push(["Nhận xét chi tiết:"]);
    parsedDeliveryReport.forEach(report => {
      summaryData.push(["", "-", report]);
    });

    if (parsedDelayedItems.length > 0) {
      summaryData.push([""]);
      summaryData.push(["Cảnh báo chậm trễ:", `Có ${parsedDelayedItems.length} vật tư đang chậm trễ:`]);
      parsedDelayedItems.forEach(item => {
        summaryData.push(["", "-", item]);
      });
    }

    const wsSummary = XLSX.utils.aoa_to_sheet(summaryData);
    wsSummary['!cols'] = [{ wch: 20 }, { wch: 5 }, { wch: 100 }];

    // 2. Create Details Worksheet (Bảng Dữ Liệu)
    const worksheet = XLSX.utils.json_to_sheet(results.table.map(row => ({
      "STT": row.stt,
      "Mã PR": row.prNo,
      "Mô Tả Vật Tư": row.description,
      "ĐVT": row.unit,
      "Số Lượng": row.quantity,
      "Đơn Giá": row.unitPrice,
      "Thành Tiền": row.totalAmount,
      "Ngày Đề Xuất": row.proposalDate,
      "Ngày Dự Kiến": row.expectedDate,
      "Ngày Thực Tế": row.actualDate,
      "Trạng Thái": row.status
    })));

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, wsSummary, "Bao_Cao_Tong_Quan");
    XLSX.utils.book_append_sheet(workbook, worksheet, "Bang_Du_Lieu");
    XLSX.writeFile(workbook, "Bao_Cao_MRO.xlsx");
  };

  return (
    <div className="min-h-screen p-6 md:p-12 max-w-[1600px] mx-auto flex flex-col gap-8">
      {/* ⬆️ TOP ROW: Upload & Report */}
      <div className="flex flex-col xl:flex-row gap-8 items-start w-full">
        {/* Upload & Settings (Left) */}
        <div className="w-full xl:w-[450px] shrink-0 space-y-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-zinc-900 border-l-4 border-zinc-900 pl-4 py-1">
            MRO Intelligence
          </h1>
          <p className="text-sm text-zinc-500 mt-2 uppercase tracking-widest font-semibold">
            IBS Heavy Industry Data Terminal
          </p>
        </div>

        <label 
          onDragOver={(e) => e.preventDefault()}
          onDrop={handleDrop}
          className="dropzone-container group mt-8 relative block"
        >
          <input 
            type="file" 
            accept=".pdf, .xlsx, .xls, .csv" 
            onChange={handleFileChange}
            className="hidden" 
          />
          <div className="flex flex-col items-center gap-4 text-zinc-400 group-hover:text-zinc-700 transition-colors">
            {loading ? (
              <Loader2 className="w-10 h-10 animate-spin text-zinc-900" />
            ) : file ? (
              <FileText className="w-10 h-10" />
            ) : (
              <UploadCloud className="w-10 h-10" />
            )}
            <div className="text-center">
              <p className="font-semibold text-zinc-800">
                {file ? file.name : 'Upload PDF hoặc XLSX'}
              </p>
              <p className="text-xs mt-1">
                Kéo thả file vào đây hoặc nhấn để chọn
              </p>
            </div>
          </div>
          {loading && (
             <div className="absolute inset-x-0 bottom-0 h-1 bg-zinc-200 overflow-hidden">
               <div className="h-full bg-zinc-900 w-1/3 animate-[slide_1.5s_ease-in-out_infinite]" />
             </div>
          )}
        </label>

        {error && (
          <div className="p-4 bg-red-50 text-red-700 border border-red-200 text-sm font-medium flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 shrink-0" />
            <p>{error}</p>
          </div>
        )}

        <div className="text-xs text-zinc-500 bg-zinc-100 p-4 border border-zinc-200 leading-relaxed uppercase tracking-wide">
          <strong className="block text-zinc-700 mb-2">Rule Enforcements System:</strong>
          <ul className="list-disc pl-4 space-y-1">
            <li>Strict Output Mapping (JSON Schema)</li>
            <li>Anti-Hallucination Guardrails</li>
            <li>OCR Date Correction Enabled</li>
          </ul>
        </div>
      </div>

      {/* Report Section (Right) */}
      <div className="flex-1 w-full min-w-0">
        {!results && !loading && (
          <div className="h-full min-h-[300px] xl:min-h-[460px] border border-dashed border-indigo-200 bg-gradient-to-br from-sky-50 to-indigo-50 rounded-sm flex items-center justify-center text-indigo-300 text-sm tracking-widest uppercase">
            [ Đang chờ dữ liệu đầu vào ]
          </div>
        )}

        {loading && !results && (
          <div className="h-full min-h-[300px] xl:min-h-[460px] border border-indigo-100 bg-gradient-to-br from-sky-50 via-indigo-50 to-violet-50 rounded-sm flex items-center justify-center">
            <div className="flex flex-col items-center gap-3">
              <Loader2 className="w-8 h-8 animate-spin text-indigo-400" />
              <p className="text-sm font-medium text-indigo-400 tracking-widest uppercase">Analyzing Data...</p>
            </div>
          </div>
        )}

        {results && (
          <div className="animate-in fade-in slide-in-from-bottom-4 duration-500 h-full">
            {/* Report container with gradient background */}
            <div className="h-full bg-gradient-to-br from-sky-50 via-indigo-50 to-violet-50 border border-indigo-100 rounded-sm overflow-hidden flex flex-col">

              {/* Title bar */}
              <div className="px-6 py-3 bg-gradient-to-r from-indigo-600 to-violet-600 flex items-center justify-between">
                <p className="font-bold text-white text-sm uppercase tracking-widest">Báo Cáo Nhanh & Đánh Giá Tiến Độ</p>
                <div className="flex items-center gap-2">
                  <button
                    onClick={handleReevaluate}
                    disabled={isReevaluating}
                    className="flex items-center gap-1.5 px-4 py-1.5 bg-white/15 hover:bg-white/25 text-white border border-white/30 rounded-[2px] text-xs font-semibold whitespace-nowrap transition-all disabled:opacity-50"
                  >
                    {isReevaluating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                    Đánh Giá Lại
                  </button>
                  <button
                    onClick={exportToExcel}
                    className="flex items-center gap-1.5 px-4 py-1.5 bg-emerald-500 hover:bg-emerald-400 text-white rounded-[2px] text-xs font-semibold whitespace-nowrap transition-all"
                  >
                    <Download className="w-3.5 h-3.5" />
                    Xuất Excel
                  </button>
                </div>
              </div>

              {/* Stat cards row */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 p-4 border-b border-indigo-100">
                <div className="bg-white rounded-sm p-3 border border-indigo-100 shadow-sm">
                  <p className="text-[10px] uppercase tracking-widest text-indigo-400 font-semibold mb-1">Tổng đơn hàng</p>
                  <p className="text-2xl font-bold text-indigo-700">{results.summary.total}</p>
                </div>
                <div className="bg-white rounded-sm p-3 border border-emerald-100 shadow-sm">
                  <p className="text-[10px] uppercase tracking-widest text-emerald-500 font-semibold mb-1">Đã về</p>
                  <p className="text-2xl font-bold text-emerald-600">{results.summary.completed}</p>
                  <p className="text-[11px] text-emerald-400 font-medium">{results.summary.completedPercentage}</p>
                </div>
                <div className="bg-white rounded-sm p-3 border border-amber-100 shadow-sm">
                  <p className="text-[10px] uppercase tracking-widest text-amber-500 font-semibold mb-1">Chưa về</p>
                  <p className="text-2xl font-bold text-amber-600">{results.summary.pending}</p>
                  <p className="text-[11px] text-amber-400 font-medium">{results.summary.pendingPercentage}</p>
                </div>
                <div className="bg-white rounded-sm p-3 border border-rose-100 shadow-sm">
                  <p className="text-[10px] uppercase tracking-widest text-rose-400 font-semibold mb-1">Chậm trễ</p>
                  <p className="text-2xl font-bold text-rose-600">{parsedDelayedItems.length}</p>
                  <p className="text-[11px] text-rose-300 font-medium">vật tư</p>
                </div>
              </div>

              {/* Report body */}
              <div className="flex flex-col md:flex-row gap-4 p-4 flex-1">
                {/* Delivery report */}
                <div className="flex-1 min-w-0">
                  {results.summary.totalValue && (
                    <div className="mb-3 px-3 py-2 bg-indigo-100 border border-indigo-200 rounded-sm flex items-center gap-2">
                      <span className="text-[11px] uppercase tracking-widest text-indigo-500 font-semibold">Tổng giá trị:</span>
                      <span className="text-sm font-bold text-indigo-800">{formatCurrency(results.summary.totalValue)}</span>
                    </div>
                  )}
                  {parsedDeliveryReport.length > 0 && (
                    <ul className="space-y-1.5">
                      {parsedDeliveryReport.map((report, idx) => (
                        <li key={idx} className="flex items-start gap-2 text-sm text-indigo-900">
                          <span className="mt-1.5 shrink-0 w-1.5 h-1.5 rounded-full bg-indigo-400 inline-block" />
                          {report}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                {/* Delayed warning */}
                {parsedDelayedItems.length > 0 && (
                  <div className="md:w-72 shrink-0 bg-rose-50 border border-rose-200 rounded-sm p-3">
                    <p className="flex items-center gap-1.5 text-[11px] uppercase tracking-widest font-bold text-rose-600 mb-2">
                      <AlertTriangle className="w-3.5 h-3.5" />
                      Cảnh báo chậm trễ
                    </p>
                    <ul className="space-y-1">
                      {parsedDelayedItems.map((item, idx) => (
                        <li key={idx} className="text-xs text-rose-800 font-medium flex items-start gap-1.5">
                          <span className="mt-1 shrink-0 w-1.5 h-1.5 rounded-full bg-rose-400 inline-block" />
                          {item}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>

      {/* ⬇️ BOTTOM ROW: Main Table Full Width */}
      <div className="w-full">
        {results && (
          <div className="w-full animate-in fade-in slide-in-from-bottom-8 duration-700">
            <div className="bg-white border border-zinc-200 shadow-sm overflow-hidden w-full">
              <div className="px-5 py-4 border-b border-zinc-100 flex justify-between items-center bg-zinc-50">
                <h3 className="font-semibold text-zinc-800 tracking-wide">BẢNG TỔNG HỢP DỮ LIỆU</h3>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm text-left whitespace-nowrap">
                  <thead className="bg-zinc-50 text-zinc-500 uppercase font-semibold text-[11px] tracking-wider">
                    <tr>
                      <th className="px-5 py-3 border-b border-zinc-200 w-16 text-center">STT</th>
                      <th className="px-5 py-3 border-b border-zinc-200">Mã PR</th>
                      <th className="px-5 py-3 border-b border-zinc-200 min-w-[200px]">Mô Tả Vật Tư</th>
                      <th className="px-5 py-3 border-b border-zinc-200">ĐVT</th>
                      <th className="px-5 py-3 border-b border-zinc-200 text-right">S.Lượng</th>
                      <th className="px-5 py-3 border-b border-zinc-200 text-right">Đơn Giá</th>
                      <th className="px-5 py-3 border-b border-zinc-200 text-right">Thành Tiền</th>
                      <th className="px-5 py-3 border-b border-zinc-200 text-center">Ngày Đề Xuất</th>
                      <th className="px-5 py-3 border-b border-zinc-200 text-center">Ngày Dự Kiến</th>
                      <th className="px-5 py-3 border-b border-zinc-200 text-center">Ngày Thực Tế</th>
                      <th className="px-5 py-3 border-b border-zinc-200">Trạng Thái</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-100 text-zinc-700">
                    {results.table.map((row, idx) => {
                      const isComplete = row.status === 'ĐÃ VỀ';
                      return (
                        <tr key={idx} className={`transition-colors ${row.isDelayed ? 'bg-red-50/60 hover:bg-red-100/60' : 'hover:bg-zinc-50'}`}>
                          <td className="p-0 border-b border-zinc-100 align-middle">
                            <div className="px-5 py-4 text-center text-zinc-400">{row.stt}</div>
                          </td>
                          <td className="p-0 border-b border-zinc-100 align-middle relative group focus-within:z-10">
                            <input value={row.prNo || ''} onChange={(e) => handleCellChange(idx, 'prNo', e.target.value)} className="w-full bg-transparent px-5 py-4 font-mono text-zinc-900 border-none outline-none focus:bg-white focus:ring-1 focus:ring-blue-500 hover:bg-zinc-100/50 transition-colors" />
                          </td>
                          <td className="p-0 border-b border-zinc-100 align-middle relative group focus-within:z-10">
                            <input value={row.description || ''} onChange={(e) => handleCellChange(idx, 'description', e.target.value)} className="w-full min-w-[200px] bg-transparent px-5 py-4 truncate border-none outline-none focus:bg-white focus:ring-1 focus:ring-blue-500 hover:bg-zinc-100/50 transition-colors" title={row.description} />
                          </td>
                          <td className="p-0 border-b border-zinc-100 align-middle relative group focus-within:z-10">
                            <input value={row.unit || ''} onChange={(e) => handleCellChange(idx, 'unit', e.target.value)} className="w-full bg-transparent px-5 py-4 border-none outline-none focus:bg-white focus:ring-1 focus:ring-blue-500 hover:bg-zinc-100/50 transition-colors" />
                          </td>
                          <td className="p-0 border-b border-zinc-100 align-middle relative group focus-within:z-10">
                            <input value={row.quantity || ''} onChange={(e) => handleCellChange(idx, 'quantity', e.target.value)} className="w-full text-right bg-transparent px-5 py-4 font-mono text-zinc-700 font-medium border-none outline-none focus:bg-white focus:ring-1 focus:ring-blue-500 hover:bg-zinc-100/50 transition-colors" />
                          </td>
                          <td className="p-0 border-b border-zinc-100 align-middle relative group focus-within:z-10">
                            <input value={row.unitPrice || ''} onChange={(e) => handleCellChange(idx, 'unitPrice', e.target.value)} className="w-full text-right bg-transparent px-5 py-4 font-mono text-zinc-500 border-none outline-none focus:bg-white focus:ring-1 focus:ring-blue-500 hover:bg-zinc-100/50 transition-colors" />
                          </td>
                          <td className="p-0 border-b border-zinc-100 align-middle">
                            <div className="w-full text-right bg-transparent px-5 py-4 font-mono text-zinc-900 font-medium">{formatCurrency(row.totalAmount)}</div>
                          </td>
                          <td className="p-0 border-b border-zinc-100 align-middle relative group focus-within:z-10">
                            <input value={row.proposalDate || ''} onChange={(e) => handleCellChange(idx, 'proposalDate', e.target.value)} className="w-full text-center bg-transparent px-5 py-4 font-mono text-zinc-500 border-none outline-none focus:bg-white focus:ring-1 focus:ring-blue-500 hover:bg-zinc-100/50 transition-colors" />
                          </td>
                          <td className="p-0 border-b border-zinc-100 align-middle relative group focus-within:z-10">
                            <input value={row.expectedDate || ''} onChange={(e) => handleCellChange(idx, 'expectedDate', e.target.value)} className={`w-full text-center bg-transparent px-5 py-4 font-mono border-none outline-none focus:bg-white focus:ring-1 focus:ring-blue-500 hover:bg-zinc-100/50 transition-colors ${row.isDelayed && !isComplete ? 'text-red-600 font-semibold' : 'text-zinc-500'}`} />
                          </td>
                          <td className="p-0 border-b border-zinc-100 align-middle relative group focus-within:z-10">
                            <input value={row.actualDate || ''} onChange={(e) => handleCellChange(idx, 'actualDate', e.target.value)} className={`w-full text-center bg-transparent px-5 py-4 font-mono border-none outline-none focus:bg-white focus:ring-1 focus:ring-blue-500 hover:bg-zinc-100/50 transition-colors ${isComplete ? (row.isDelayed ? 'text-red-600 font-semibold' : 'text-emerald-600 font-medium') : 'text-zinc-500'}`} />
                          </td>
                          <td className="px-5 py-4">
                            <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-[2px] text-xs font-semibold ${isComplete ? 'bg-emerald-100 text-emerald-800' : 'bg-orange-100 text-orange-800'}`}>
                              {isComplete ? <CheckCircle2 className="w-3 h-3" /> : <Clock className="w-3 h-3" />}
                              {row.status}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default App;
