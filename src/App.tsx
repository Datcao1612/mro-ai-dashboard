import { useState } from 'react';
import { extractTextFromFile } from './utils/fileParser';
import { analyzeMROData } from './utils/aiClient';
import type { MROAnalysisResult, MROItem } from './utils/aiClient';
import {
  UploadCloud, CheckCircle2, Clock, AlertTriangle,
  FileText, Loader2, Download, Sparkles,
  ShieldCheck, Zap, ScanText, Package,
} from 'lucide-react';
// xlsx is dynamically imported inside exportToExcel() — not bundled at startup

// ─── StatCard helper ────────────────────────────────────────────────────────

type CardColor = 'indigo' | 'emerald' | 'amber' | 'rose';
const CARD_COLORS: Record<CardColor, { label: string; value: string; sub: string; border: string }> = {
  indigo:  { label: 'text-indigo-500',  value: 'text-indigo-700',  sub: 'text-indigo-400',  border: 'border-indigo-100' },
  emerald: { label: 'text-emerald-500', value: 'text-emerald-600', sub: 'text-emerald-400', border: 'border-emerald-100' },
  amber:   { label: 'text-amber-500',   value: 'text-amber-600',   sub: 'text-amber-400',   border: 'border-amber-100' },
  rose:    { label: 'text-rose-400',    value: 'text-rose-600',    sub: 'text-rose-300',    border: 'border-rose-100' },
};

function StatCard({ label, value, sub, color }: { label: string; value: number; sub?: string; color: CardColor }) {
  const c = CARD_COLORS[color];
  return (
    <div className={`bg-white p-3 border ${c.border} shadow-sm`}>
      <p className={`text-[10px] uppercase tracking-widest font-semibold mb-1 ${c.label}`}>{label}</p>
      <p className={`text-2xl font-bold leading-none ${c.value}`}>{value}</p>
      {sub && <p className={`text-[11px] font-medium mt-0.5 ${c.sub}`}>{sub}</p>}
    </div>
  );
}

// ─── Main App ───────────────────────────────────────────────────────────────

function App() {
  const [file, setFile]                     = useState<File | null>(null);
  const [loading, setLoading]               = useState(false);
  const [error, setError]                   = useState<string | null>(null);
  const [results, setResults]               = useState<MROAnalysisResult | null>(null);
  const [isReevaluating, setIsReevaluating] = useState(false);

  // ── Handlers ──────────────────────────────────────────────────────────────

  const handleCellChange = (index: number, field: keyof MROItem, value: string) => {
    if (!results) return;
    const newTable = [...results.table];
    newTable[index] = { ...newTable[index], [field]: value };
    if (field === 'quantity' || field === 'unitPrice') {
      const qty  = parseFloat(String(newTable[index].quantity  || '').replace(/,/g, '')) || 0;
      const cost = parseFloat(String(newTable[index].unitPrice || '').replace(/,/g, '')) || 0;
      if (qty > 0 && cost > 0) newTable[index].totalAmount = String(qty * cost);
    }
    setResults({ ...results, table: newTable });
  };

  const handleReevaluate = async () => {
    if (!results) return;
    setIsReevaluating(true);
    setError(null);
    try {
      const headers = ['STT','Mã PR','Mô Tả Vật Tư','ĐVT','Số Lượng','Đơn Giá','Thành Tiền','Ngày Đề Xuất','Ngày Dự Kiến','Ngày Thực Tế','Trạng Thái'];
      const csvRows = results.table.map(row =>
        [row.stt,
          `"${String(row.prNo        || '').replace(/"/g,'""')}"`,
          `"${String(row.description || '').replace(/"/g,'""')}"`,
          `"${String(row.unit        || '').replace(/"/g,'""')}"`,
          `"${String(row.quantity    || '').replace(/"/g,'""')}"`,
          `"${String(row.unitPrice   || '').replace(/"/g,'""')}"`,
          `"${String(row.totalAmount || '').replace(/"/g,'""')}"`,
          `"${String(row.proposalDate|| '').replace(/"/g,'""')}"`,
          `"${String(row.expectedDate|| '').replace(/"/g,'""')}"`,
          `"${String(row.actualDate  || '').replace(/"/g,'""')}"`,
          `"${String(row.status      || '').replace(/"/g,'""')}"`,
        ].join(',')
      );
      const payload = `--- BÁO CÁO MRO DÙNG ĐỂ ĐÁNH GIÁ LẠI ---\n\n` +
        [headers.join(','), ...csvRows].join('\n');
      setResults(await analyzeMROData(payload));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Có lỗi trong quá trình Đánh giá lại.');
    } finally {
      setIsReevaluating(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    if (e.dataTransfer.files?.[0]) handleFile(e.dataTransfer.files[0]);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files?.[0]) handleFile(e.target.files[0]);
  };

  const handleFile = async (selectedFile: File) => {
    setFile(selectedFile);
    setLoading(true);
    setError(null);
    setResults(null);
    try {
      const rawText = await extractTextFromFile(selectedFile);
      setResults(await analyzeMROData(rawText));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Có lỗi xảy ra trong quá trình trích xuất.');
    } finally {
      setLoading(false);
    }
  };

  // ── Derived data ───────────────────────────────────────────────────────────

  const formatCurrency = (val: string | undefined | number): string => {
    if (!val || val === '-' || val === 0) return '-';
    const num = parseFloat(String(val).replace(/,/g, '').trim());
    if (isNaN(num)) return String(val);
    return new Intl.NumberFormat('en-US').format(num);
  };

  const parsedDeliveryReport = results
    ? (results.summary.deliveryReport || [])
        .flatMap(r => r.split('\n'))
        .map(r => r.replace(/^-\s*/, '').trim())
        .filter(r => r.length > 0)
    : [];

  const parsedDelayedItems = results
    ? results.table
        .filter(row => row.isDelayed)
        .map(row => row.description || 'Vật tư không tên')
        .filter(d => d.trim().length > 0)
    : [];

  // ── Export ─────────────────────────────────────────────────────────────────

  const exportToExcel = async () => {
    if (!results) return;
    // Dynamic import — xlsx is only fetched when user clicks "Xuất Excel"
    const XLSX = await import('xlsx');

    const summaryData: (string | number)[][] = [
      ['BÁO CÁO NHANH & ĐÁNH GIÁ TIẾN ĐỘ'],
      [''],
      ['Tình hình chung:', `Tổng ${results.summary.total} đơn. Đã về: ${results.summary.completed} (${results.summary.completedPercentage}). Chưa về: ${results.summary.pending} (${results.summary.pendingPercentage}).`],
    ];
    if (results.summary.totalValue) summaryData.push(['Tổng giá trị:', formatCurrency(results.summary.totalValue)]);
    summaryData.push([''], ['Nhận xét chi tiết:']);
    parsedDeliveryReport.forEach(r => summaryData.push(['', '-', r]));
    if (parsedDelayedItems.length > 0) {
      summaryData.push([''], [`Cảnh báo chậm trễ:`, `${parsedDelayedItems.length} vật tư:`]);
      parsedDelayedItems.forEach(item => summaryData.push(['', '-', item]));
    }

    const wsSummary = XLSX.utils.aoa_to_sheet(summaryData);
    wsSummary['!cols'] = [{ wch: 20 }, { wch: 5 }, { wch: 100 }];

    const wsData = XLSX.utils.json_to_sheet(results.table.map(row => ({
      'STT': row.stt, 'Mã PR': row.prNo, 'Mô Tả Vật Tư': row.description,
      'ĐVT': row.unit, 'Số Lượng': row.quantity, 'Đơn Giá': row.unitPrice,
      'Thành Tiền': row.totalAmount, 'Ngày Đề Xuất': row.proposalDate,
      'Ngày Dự Kiến': row.expectedDate, 'Ngày Thực Tế': row.actualDate,
      'Trạng Thái': row.status,
    })));

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, wsSummary, 'Bao_Cao_Tong_Quan');
    XLSX.utils.book_append_sheet(wb, wsData,    'Bang_Du_Lieu');
    XLSX.writeFile(wb, 'Bao_Cao_MRO.xlsx');
  };

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-zinc-50">

      {/* ── Sticky Header ────────────────────────────────────────────────── */}
      <header className="sticky top-0 z-20 h-13 bg-white border-b border-zinc-200 flex items-center px-6 gap-4">
        <div className="w-7 h-7 bg-zinc-900 flex items-center justify-center shrink-0">
          <Package className="w-3.5 h-3.5 text-white" />
        </div>
        <span className="font-bold text-zinc-900 tracking-tight text-sm">MRO Intelligence</span>
        <span className="h-4 w-px bg-zinc-200 hidden sm:block" />
        <span className="text-xs text-zinc-400 uppercase tracking-widest font-medium hidden sm:block">
          IBS Heavy Industry
        </span>

        {/* Right: AI status */}
        <div className="ml-auto flex items-center gap-2">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
          <span className="text-xs text-zinc-400 hidden sm:block">Gemini 2.5 Flash Lite</span>
        </div>
      </header>

      {/* ── Main Content ─────────────────────────────────────────────────── */}
      <main className="max-w-[1600px] mx-auto p-6 md:p-8 flex flex-col gap-6">

        {/* TOP ROW: Upload (left) + Report (right) */}
        <div className="flex flex-col xl:flex-row gap-6 items-start">

          {/* ── Left: Upload Panel ────────────────────────────────────────── */}
          <div className="w-full xl:w-[360px] shrink-0 space-y-4">

            {/* Dropzone */}
            <label
              onDragOver={(e) => e.preventDefault()}
              onDrop={handleDrop}
              className="dropzone-container group"
            >
              <input
                type="file"
                accept=".pdf, .xlsx, .xls, .csv"
                onChange={handleFileChange}
                className="hidden"
              />
              <div className="flex flex-col items-center gap-3 text-zinc-400 group-hover:text-zinc-700 transition-colors">
                {loading ? (
                  <Loader2 className="w-9 h-9 animate-spin text-indigo-500" />
                ) : file ? (
                  <FileText className="w-9 h-9 text-indigo-400" />
                ) : (
                  <UploadCloud className="w-9 h-9" />
                )}
                <div className="text-center">
                  <p className="font-semibold text-zinc-700 text-sm">
                    {file ? file.name : 'Upload PDF hoặc XLSX'}
                  </p>
                  <p className="text-xs mt-0.5 text-zinc-400">
                    {loading ? 'Đang phân tích dữ liệu...' : 'Kéo thả hoặc nhấn để chọn'}
                  </p>
                </div>
                {!file && !loading && (
                  <span className="text-[11px] uppercase tracking-widest text-zinc-300 font-medium">
                    PDF · XLSX · XLS · CSV
                  </span>
                )}
              </div>

              {/* Loading bar */}
              {loading && (
                <div className="absolute inset-x-0 bottom-0 h-0.5 bg-zinc-100 overflow-hidden">
                  <div className="h-full w-1/3 bg-indigo-500" style={{ animation: 'slide 1.5s ease-in-out infinite' }} />
                </div>
              )}
            </label>

            {/* Error */}
            {error && (
              <div className="p-3.5 bg-red-50 border border-red-200 text-red-700 text-sm flex items-start gap-2.5">
                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                <p>{error}</p>
              </div>
            )}

            {/* Guard rails info */}
            <div className="bg-white border border-zinc-200 divide-y divide-zinc-100">
              {([
                { Icon: ShieldCheck, label: 'Strict Output Mapping',   sub: 'JSON Schema enforced' },
                { Icon: Zap,         label: 'Anti-Hallucination',      sub: 'Guardrails active' },
                { Icon: ScanText,    label: 'OCR Date Correction',     sub: 'Auto-fix enabled' },
              ] as const).map(({ Icon, label, sub }) => (
                <div key={label} className="flex items-center gap-3 px-4 py-3">
                  <Icon className="w-4 h-4 text-zinc-400 shrink-0" />
                  <div>
                    <p className="text-xs font-semibold text-zinc-700">{label}</p>
                    <p className="text-[11px] text-zinc-400">{sub}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* ── Right: Report Panel ──────────────────────────────────────── */}
          <div className="flex-1 w-full min-w-0">

            {/* Empty state */}
            {!results && !loading && (
              <div className="h-[280px] border border-dashed border-zinc-200 bg-white flex flex-col items-center justify-center gap-3 text-zinc-300">
                <UploadCloud className="w-10 h-10" />
                <p className="text-xs uppercase tracking-widest font-medium">Đang chờ dữ liệu đầu vào</p>
              </div>
            )}

            {/* Loading state */}
            {loading && !results && (
              <div className="h-[280px] border border-indigo-100 bg-gradient-to-br from-sky-50 via-indigo-50 to-violet-50 flex items-center justify-center">
                <div className="flex flex-col items-center gap-3">
                  <div className="relative w-12 h-12">
                    <div className="absolute inset-0 rounded-full border-2 border-indigo-100" />
                    <Loader2 className="absolute inset-0 m-auto w-6 h-6 animate-spin text-indigo-400" />
                  </div>
                  <p className="text-xs font-semibold text-indigo-400 tracking-widest uppercase">Analyzing Data...</p>
                </div>
              </div>
            )}

            {/* Results */}
            {results && (
              <div className="animate-in fade-in slide-in-from-bottom-2 duration-500">
                <div className="border border-indigo-100 bg-gradient-to-br from-sky-50 via-indigo-50 to-violet-50 overflow-hidden">

                  {/* Title bar */}
                  <div className="px-5 py-3 bg-gradient-to-r from-indigo-600 to-violet-600 flex items-center justify-between gap-3">
                    <p className="font-bold text-white text-xs uppercase tracking-widest truncate">
                      Báo Cáo Nhanh &amp; Đánh Giá Tiến Độ
                    </p>
                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        onClick={handleReevaluate}
                        disabled={isReevaluating}
                        className="flex items-center gap-1.5 px-3 py-1.5 bg-white/15 hover:bg-white/25 text-white border border-white/30 text-xs font-semibold transition-all disabled:opacity-50"
                      >
                        {isReevaluating
                          ? <Loader2 className="w-3 h-3 animate-spin" />
                          : <Sparkles className="w-3 h-3" />}
                        Đánh Giá Lại
                      </button>
                      <button
                        onClick={exportToExcel}
                        className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-500 hover:bg-emerald-400 text-white text-xs font-semibold transition-all"
                      >
                        <Download className="w-3 h-3" />
                        Xuất Excel
                      </button>
                    </div>
                  </div>

                  {/* Stat cards */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 p-4 border-b border-indigo-100/60">
                    <StatCard label="Tổng đơn hàng" value={results.summary.total}            color="indigo"  />
                    <StatCard label="Đã về"          value={results.summary.completed}        color="emerald" sub={results.summary.completedPercentage} />
                    <StatCard label="Chưa về"        value={results.summary.pending}          color="amber"   sub={results.summary.pendingPercentage} />
                    <StatCard label="Chậm trễ"       value={parsedDelayedItems.length}        color="rose"    sub="vật tư" />
                  </div>

                  {/* Report body */}
                  <div className="flex flex-col md:flex-row gap-4 p-4">

                    {/* Delivery report */}
                    <div className="flex-1 min-w-0 space-y-3">
                      {results.summary.totalValue && (
                        <div className="inline-flex items-center gap-2 px-3 py-1.5 bg-indigo-100 border border-indigo-200">
                          <span className="text-[10px] uppercase tracking-widest text-indigo-500 font-semibold">Tổng giá trị:</span>
                          <span className="text-sm font-bold text-indigo-800">{formatCurrency(results.summary.totalValue)}</span>
                        </div>
                      )}
                      {parsedDeliveryReport.length > 0 && (
                        <ul className="space-y-1.5">
                          {parsedDeliveryReport.map((report, idx) => (
                            <li key={idx} className="flex items-start gap-2 text-sm text-indigo-900">
                              <span className="mt-2 shrink-0 w-1 h-1 rounded-full bg-indigo-400 inline-block" />
                              {report}
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>

                    {/* Delayed warning panel */}
                    {parsedDelayedItems.length > 0 && (
                      <div className="md:w-60 shrink-0 bg-rose-50 border border-rose-200 p-3">
                        <p className="flex items-center gap-1.5 text-[10px] uppercase tracking-widest font-bold text-rose-600 mb-2">
                          <AlertTriangle className="w-3 h-3" />
                          Cảnh báo chậm trễ
                        </p>
                        <ul className="space-y-1.5">
                          {parsedDelayedItems.map((item, idx) => (
                            <li key={idx} className="text-xs text-rose-800 font-medium flex items-start gap-1.5">
                              <span className="mt-1 shrink-0 w-1 h-1 rounded-full bg-rose-400 inline-block" />
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

        {/* ── BOTTOM ROW: Full-width Table ───────────────────────────────── */}
        {results && (
          <div className="animate-in fade-in slide-in-from-bottom-4 duration-700">
            <div className="bg-white border border-zinc-200 shadow-sm overflow-hidden">

              {/* Table header bar */}
              <div className="px-5 py-3.5 border-b border-zinc-100 bg-zinc-50 flex items-center justify-between">
                <h3 className="text-xs font-semibold text-zinc-600 uppercase tracking-widest">
                  Bảng Tổng Hợp Dữ Liệu
                </h3>
                <span className="text-xs text-zinc-400">{results.table.length} dòng</span>
              </div>

              {/* Scrollable table with sticky header */}
              <div className="overflow-x-auto max-h-[520px] overflow-y-auto">
                <table className="w-full text-sm text-left whitespace-nowrap">
                  <thead className="sticky top-0 z-10 bg-zinc-50 border-b border-zinc-200">
                    <tr>
                      {[
                        { label: 'STT',          cls: 'w-12 text-center' },
                        { label: 'Mã PR',        cls: '' },
                        { label: 'Mô Tả Vật Tư',cls: 'min-w-[220px]' },
                        { label: 'ĐVT',          cls: '' },
                        { label: 'S.Lượng',      cls: 'text-right' },
                        { label: 'Đơn Giá',      cls: 'text-right' },
                        { label: 'Thành Tiền',   cls: 'text-right' },
                        { label: 'Ngày ĐX',      cls: 'text-center' },
                        { label: 'Ngày DK',      cls: 'text-center' },
                        { label: 'Ngày TT',      cls: 'text-center' },
                        { label: 'Trạng Thái',   cls: '' },
                      ].map(({ label, cls }) => (
                        <th key={label} className={`px-4 py-3 text-[11px] uppercase tracking-wider font-semibold text-zinc-500 ${cls}`}>
                          {label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-100">
                    {results.table.map((row, idx) => {
                      const isComplete = row.status === 'ĐÃ VỀ';
                      return (
                        <tr
                          key={idx}
                          className={`transition-colors ${row.isDelayed ? 'bg-rose-50/50 hover:bg-rose-50' : 'hover:bg-zinc-50/80'}`}
                        >
                          {/* STT */}
                          <td className="px-4 py-3 text-center text-xs text-zinc-400 font-mono">{row.stt}</td>

                          {/* Editable cells */}
                          <td className="p-0 focus-within:z-10 relative">
                            <input value={row.prNo || ''} onChange={(e) => handleCellChange(idx, 'prNo', e.target.value)}
                              className="cell-input font-mono text-zinc-800" />
                          </td>
                          <td className="p-0 focus-within:z-10 relative">
                            <input value={row.description || ''} onChange={(e) => handleCellChange(idx, 'description', e.target.value)}
                              className="cell-input min-w-[220px]" title={row.description} />
                          </td>
                          <td className="p-0 focus-within:z-10 relative">
                            <input value={row.unit || ''} onChange={(e) => handleCellChange(idx, 'unit', e.target.value)}
                              className="cell-input" />
                          </td>
                          <td className="p-0 focus-within:z-10 relative">
                            <input value={row.quantity || ''} onChange={(e) => handleCellChange(idx, 'quantity', e.target.value)}
                              className="cell-input text-right font-mono" />
                          </td>
                          <td className="p-0 focus-within:z-10 relative">
                            <input value={row.unitPrice || ''} onChange={(e) => handleCellChange(idx, 'unitPrice', e.target.value)}
                              className="cell-input text-right font-mono text-zinc-500" />
                          </td>

                          {/* Thành Tiền (read-only) */}
                          <td className="px-4 py-3 text-right font-mono text-zinc-800 font-medium">
                            {formatCurrency(row.totalAmount)}
                          </td>

                          {/* Date cells */}
                          <td className="p-0 focus-within:z-10 relative">
                            <input value={row.proposalDate || ''} onChange={(e) => handleCellChange(idx, 'proposalDate', e.target.value)}
                              className="cell-input text-center font-mono text-zinc-500" />
                          </td>
                          <td className="p-0 focus-within:z-10 relative">
                            <input value={row.expectedDate || ''} onChange={(e) => handleCellChange(idx, 'expectedDate', e.target.value)}
                              className={`cell-input text-center font-mono ${row.isDelayed && !isComplete ? 'text-rose-600 font-semibold' : 'text-zinc-500'}`} />
                          </td>
                          <td className="p-0 focus-within:z-10 relative">
                            <input value={row.actualDate || ''} onChange={(e) => handleCellChange(idx, 'actualDate', e.target.value)}
                              className={`cell-input text-center font-mono ${isComplete ? (row.isDelayed ? 'text-rose-600 font-semibold' : 'text-emerald-600 font-medium') : 'text-zinc-500'}`} />
                          </td>

                          {/* Status badge */}
                          <td className="px-4 py-3">
                            <span className={`inline-flex items-center gap-1 px-2 py-0.5 text-[11px] font-semibold ${isComplete ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'}`}>
                              {isComplete
                                ? <CheckCircle2 className="w-3 h-3" />
                                : <Clock className="w-3 h-3" />}
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

      </main>
    </div>
  );
}

export default App;
