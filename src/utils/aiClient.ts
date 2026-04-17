import { GoogleGenAI, Type } from '@google/genai';

const getApiKey = (): string => import.meta.env.VITE_GEMINI_API_KEY || '';

// ── Singleton client ───────────────────────────────────────────────────────────
// GoogleGenAI is created once and reused across all calls, avoiding redundant
// object construction and potential connection overhead on every request.
let _client: GoogleGenAI | null = null;
const getClient = (): GoogleGenAI => {
  if (!_client) {
    const apiKey = getApiKey();
    if (!apiKey) {
      throw new Error('Missing VITE_GEMINI_API_KEY environment variable. Vui lòng thiết lập API key.');
    }
    _client = new GoogleGenAI({ apiKey });
  }
  return _client;
};

export interface MROItem {
  stt: number;
  prNo: string;
  description: string;
  unit: string;
  quantity: string;
  unitPrice: string;
  totalAmount: string;
  proposalDate: string;
  expectedDate: string;
  actualDate: string;
  status: string;
  leadTime: string;
  isDelayed: boolean;
}

export interface MROAnalysisResult {
  summary: {
    total: number;
    completed: number;
    completedPercentage: string;
    pending: number;
    pendingPercentage: string;
    delayedItems: string[];
    totalValue: string;
    deliveryReport: string[];
  };
  table: MROItem[];
}

const responseSchema = {
  type: Type.OBJECT,
  properties: {
    summary: {
      type: Type.OBJECT,
      properties: {
        total: { type: Type.INTEGER },
        completed: { type: Type.INTEGER },
        completedPercentage: { type: Type.STRING },
        pending: { type: Type.INTEGER },
        pendingPercentage: { type: Type.STRING },
        delayedItems: { type: Type.ARRAY, items: { type: Type.STRING } },
        totalValue: { type: Type.STRING },
        deliveryReport: { type: Type.ARRAY, items: { type: Type.STRING } }
      },
      required: ['total', 'completed', 'completedPercentage', 'pending', 'pendingPercentage', 'delayedItems', 'totalValue', 'deliveryReport']
    },
    table: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          stt: { type: Type.INTEGER },
          prNo: { type: Type.STRING },
          description: { type: Type.STRING },
          unit: { type: Type.STRING },
          quantity: { type: Type.STRING },
          unitPrice: { type: Type.STRING },
          totalAmount: { type: Type.STRING },
          proposalDate: { type: Type.STRING },
          expectedDate: { type: Type.STRING },
          actualDate: { type: Type.STRING },
          status: { type: Type.STRING },
          leadTime: { type: Type.STRING },
          isDelayed: { type: Type.BOOLEAN, description: "True nếu Đã Về nhưng actualDate trễ hơn expectedDate, HOẶC Chưa Về nhưng ngày hiện tại đã qua expectedDate. False nếu ngược lại." }
        },
        required: ['stt', 'prNo', 'description', 'unit', 'quantity', 'unitPrice', 'totalAmount', 'proposalDate', 'expectedDate', 'actualDate', 'status', 'leadTime', 'isDelayed']
      }
    }
  },
  required: ['summary', 'table']
};

const SYSTEM_PROMPT = `[VAI TRÒ]
Bạn là Chuyên gia Phân tích Dữ liệu Chuỗi cung ứng tại IBS Heavy Industry. Nhiệm vụ của bạn là trích xuất và chuẩn hóa dữ liệu MRO.

[QUY TRÌNH XỬ LÝ]
1. Đọc kỹ dòng text, lấy đúng mã PR (Ví dụ: 4077-2026).
- ANTI-HALLUCINATION: Tuyệt đối KHÔNG tự chế mã PR. Giữ nguyên mã kỹ thuật.
- Nếu không thấy ngày/thiếu dữ liệu, hãy để chuỗi rỗng "".
2. Trích xuất Dữ liệu Kỹ thuật & Giá cả:
- Lấy 'Số lượng' (quantity), 'Đơn giá' (unitPrice) và 'Thành tiền' (totalAmount). Lưu ý nhận diện định dạng số liệu có dấu phân cách nghìn.
- Nếu không có Thành tiền, tự tính: totalAmount = quantity * unitPrice.
3. Phân tích Tiến độ & Tìm Ngày Dự Kiến:
- Trích xuất 'Ngày đề xuất' (proposalDate) và 'Ngày thực tế hàng về' (actualDate).
- SÀNG LỌC NGÀY DỰ KIẾN (expectedDate): Nếu file có thông tin "Thời gian giao hàng" (Ví dụ: "30 ngày"), hãy cộng số ngày này vào 'Ngày đề xuất' để tính ra 'Ngày dự kiến'. Hoặc tìm trực tiếp các mốc thời gian "Kế hoạch hàng về", "Deadline".
- Nếu 'Ngày thực tế' có dữ liệu -> ĐÃ VỀ. Nếu trống -> CHƯA VỀ.
4. Đánh giá chất lượng (deliveryReport) & Cảnh báo:
- Đánh giá "tiến độ hàng về có đạt không", báo cáo thông tin đơn hàng theo TÊN VẬT TƯ (Tên mô tả).
- TRƯỜNG 'isDelayed' TỪNG DÒNG (Table): Đơn hàng BẮT BUỘC đánh dấu isDelayed = true nếu: 
  (1) Đã về nhưng ngày thực tế muộn hơn ngày dự kiến.
  (2) CHƯA VỀ nhưng ngày hôm nay đã vượt quá ngày dự kiến.
- Viết 2-3 gạch đầu dòng báo cáo tổng quan.
- Tính tổng cộng 'totalValue' của các mục nếu có.
5. HIỆU CHỈNH OCR:
- Nếu ngày ghi sai năm (ví dụ 13/3/2006 do lỗi OCR), hãy tự sửa về 2026 theo context.`;

export async function analyzeMROData(rawText: string): Promise<MROAnalysisResult> {
  const ai = getClient(); // reuse singleton
  const response = await ai.models.generateContent({
    model: 'gemini-2.5-flash-lite',
    contents: rawText,
    config: {
      systemInstruction: SYSTEM_PROMPT,
      responseMimeType: 'application/json',
      responseSchema: responseSchema,
      temperature: 0.1 // Low temp for strictly analytical extraction
    }
  });

  const textOutput = response.text;
  if (!textOutput) {
    throw new Error("Không có phản hồi từ AI.");
  }
  
  try {
    const data = JSON.parse(textOutput) as MROAnalysisResult;
    return data;
  } catch (e) {
    throw new Error("Lỗi parse cấu trúc JSON từ AI: " + e);
  }
}
