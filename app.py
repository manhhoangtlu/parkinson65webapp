import os
import json
import numpy as np
import pandas as pd
from datetime import datetime
from flask import Flask, render_template, request, jsonify
from dotenv import load_dotenv
from scipy import signal
import google.generativeai as genai

# --- KHỞI TẠO VÀ CẤU HÌNH ---
load_dotenv()
app = Flask(__name__)

# Cấu hình Google Gemini
# Đảm bảo bạn đã đặt GOOGLE_API_KEY trong file .env
try:
    genai.configure(api_key=os.getenv("GOOGLE_API_KEY"))
    model = genai.GenerativeModel('gemini-1.5-flash')
except Exception as e:
    print(f"Lỗi khi cấu hình Gemini API: {e}")
    model = None

# Các hằng số
EXCEL_FILE = 'results.xlsx'
QUIZ_POINTS_MAP = { "A. Không": 0, "B. Thi thoảng": 1, "C. Thường xuyên": 2 }


# --- CÁC HÀM HỖ TRỢ ---

def save_to_excel(data):
    """
    Lưu một dòng kết quả mới vào file Excel.
    File sẽ tự động được tạo nếu chưa tồn tại.
    """
    # Chuẩn bị dòng mới dưới dạng một DataFrame
    df_new_row = pd.DataFrame([data])

    try:
        # Nếu file đã tồn tại, đọc và nối thêm dòng mới
        df_existing = pd.read_excel(EXCEL_FILE)
        
        # Tạo mã bệnh nhân mới một cách an toàn
        if not df_existing.empty and 'bệnh nhân số' in df_existing.columns:
            # Lọc ra các giá trị là số và tìm max
            numeric_ids = pd.to_numeric(df_existing['bệnh nhân số'], errors='coerce').dropna()
            if not numeric_ids.empty:
                last_id = int(numeric_ids.max())
                new_id = f"{last_id + 1:04d}"
            else:
                new_id = "0001"
        else:
            new_id = "0001"
            
        df_new_row['bệnh nhân số'] = new_id
        df_updated = pd.concat([df_existing, df_new_row], ignore_index=True)

    except FileNotFoundError:
        # Nếu file chưa tồn tại, đây là dòng đầu tiên
        df_new_row['bệnh nhân số'] = "0001"
        df_updated = df_new_row

    # Ghi lại toàn bộ DataFrame vào file Excel, không bao gồm chỉ số của pandas
    df_updated.to_excel(EXCEL_FILE, index=False)
    print(f"Đã lưu kết quả cho bệnh nhân số: {df_new_row['bệnh nhân số'].iloc[0]}")


def butter_bandpass_filter(data, lowcut, highcut, fs, order=4):
    """Hàm lọc tín hiệu, lấy từ code tkinter của bạn."""
    nyquist = 0.5 * fs
    low = lowcut / nyquist
    high = highcut / nyquist
    b, a = signal.butter(order, [low, high], btype='band')
    y = signal.filtfilt(b, a, data)
    return y


# === CÁC ROUTE VÀ API ===

# 1. Route chính: Phục vụ trang web frontend
@app.route('/')
def index():
    return render_template('index.html')


# 2. API chỉ tính điểm quiz và trả về, không lưu file
@app.route('/api/submit_quiz', methods=['POST'])
def submit_quiz():
    answers = request.get_json().get('answers')
    if not answers:
        return jsonify({'error': 'Không có câu trả lời nào được cung cấp'}), 400

    score = sum(QUIZ_POINTS_MAP.get(value, 0) for value in answers.values())
    return jsonify({'score': score})


# 3. API phân tích run và lưu kết quả tổng hợp vào Excel
@app.route('/api/analyze_tremor', methods=['POST'])
def analyze_tremor():
    data = request.get_json()
    tremor_data = data.get('tremor_data')
    quiz_data = data.get('quiz_data')

    if not tremor_data or not quiz_data:
        return jsonify({'error': 'Thiếu dữ liệu run hoặc quiz'}), 400

    # --- BƯỚC 1: KIỂM TRA CHẤT LƯỢNG VÀ PHÂN TÍCH TÍN HIỆU ---
    time_series = tremor_data.get('time_series')
    duration = tremor_data.get('duration')
    if not time_series or not duration or duration <= 0 or len(time_series) < 20:
        return jsonify({'error': 'Dữ liệu run không đủ hoặc không hợp lệ'}), 400

    fs = len(time_series) / duration  # Tần số lấy mẫu
    
    # KIỂM TRA NGHIÊM NGẶT TẦN SỐ LẤY MẪU
    MIN_SAMPLING_RATE = 20.0  # Bắt buộc phải lớn hơn 2 lần tần số cắt cao nhất (10Hz)

    if fs <= MIN_SAMPLING_RATE:
        error_message = f'Tần số lấy mẫu quá thấp ({fs:.2f} Hz). Cần phải lớn hơn {MIN_SAMPLING_RATE} Hz để có thể lọc trong dải tần 2-10 Hz. Vui lòng thử lại với video/camera có chất lượng tốt hơn hoặc điều kiện ánh sáng tốt hơn.'
        print(f"LỖI PHÂN TÍCH: {error_message}")
        # Trả về lỗi 400 (Bad Request) với thông báo rõ ràng cho frontend
        return jsonify({
            'error': 'Dữ liệu không đủ chất lượng',
            'message': error_message
        }), 400
    
    # Nếu qua được bước kiểm tra, tiến hành lọc và phân tích
    filtered_signal = butter_bandpass_filter(np.array(time_series), 2.0, 10.0, fs)
    
    n = len(filtered_signal)
    yf = np.fft.fft(filtered_signal)
    xf = np.fft.fftfreq(n, 1 / fs)
    
    positive_mask = xf > 0
    freqs = xf[positive_mask]
    amplitudes = np.abs(yf[positive_mask])

    peak_freq = 0
    search_range = (freqs >= 2) & (freqs <= 10)
    if np.any(search_range):
        peak_idx = np.argmax(amplitudes[search_range])
        peak_freq = freqs[search_range][peak_idx]

    is_parkinson_sign = 4.0 <= peak_freq <= 7.0
    conclusion_text = "Có dấu hiệu run của bệnh Parkinson" if is_parkinson_sign else "Không có dấu hiệu run của bệnh Parkinson"
    conclusion_color = 'red' if is_parkinson_sign else 'green'

    # --- BƯỚC 2: CHUẨN BỊ VÀ LƯU DỮ LIỆU VÀO EXCEL ---
    excel_data = {
        'thời gian đo': datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        'điểm bảng câu hỏi': quiz_data.get('score'),
        'câu trả lời từng câu hỏi': json.dumps(quiz_data.get('answers'), ensure_ascii=False),
        'tần số run': f"{peak_freq:.2f}",
        'bảng tần số run': json.dumps([round(f, 2) for f in freqs.tolist()]),
        'bảng biên độ run': json.dumps([round(a, 4) for a in amplitudes.tolist()])
    }
    save_to_excel(excel_data)
    
    # --- BƯỚC 3: TRẢ KẾT QUẢ VỀ CHO FRONTEND ĐỂ HIỂN THỊ ---
    time_axis = np.linspace(0, duration, n)
    
    return jsonify({
        'peak_frequency': peak_freq,
        'conclusion': { 'text': conclusion_text, 'color': conclusion_color },
        'time_domain_data': { 'time_axis': time_axis.tolist(), 'signal': filtered_signal.tolist() },
        'frequency_domain_data': { 'frequencies': freqs.tolist(), 'amplitudes': amplitudes.tolist() }
    })


# 4. API gọi Trợ lý AI
@app.route('/api/ai_summary', methods=['POST'])
def ai_summary():
    prompt = request.get_json().get('prompt')
    if not prompt:
        return jsonify({'error': 'Prompt is required'}), 400
    
    if not model:
        return jsonify({'error': 'AI service is not configured'}), 500
        
    try:
        response = model.generate_content(prompt)
        return jsonify({'text': response.text})
    except Exception as e:
        print(f"Error calling Gemini API: {e}")
        return jsonify({'error': 'Failed to call AI service'}), 500


# Chạy ứng dụng
if __name__ == '__main__':
    app.run(debug=True, port=5000)