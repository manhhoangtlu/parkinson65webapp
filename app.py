import os
import json
import numpy as np
import pandas as pd
from datetime import datetime
from flask import Flask, render_template, request, jsonify
from dotenv import load_dotenv
from scipy import signal
import google.generativeai as genai
import gspread

# --- KHỞI TẠO VÀ CẤU HÌNH ---
load_dotenv()
app = Flask(__name__)

# Cấu hình Google Gemini
try:
    genai.configure(api_key=os.getenv("GOOGLE_API_KEY"))
    model = genai.GenerativeModel('gemini-1.5-flash')
except Exception as e:
    print(f"Lỗi khi cấu hình Gemini API: {e}")
    model = None

# Cấu hình Google Sheets để hoạt động trên cả local và Render
worksheet = None
try:
    # Ưu tiên đọc từ biến môi trường (dành cho Render)
    creds_json_str = os.getenv("GSPREAD_CREDENTIALS")
    if creds_json_str:
        creds_dict = json.loads(creds_json_str)
        gc = gspread.service_account_from_dict(creds_dict)
        print("Đã xác thực Google Sheets từ biến môi trường (Render).")
    else:
        # Nếu không có biến môi trường, đọc từ file (dành cho máy local)
        gc = gspread.service_account(filename='credentials.json')
        print("Đã xác thực Google Sheets từ file credentials.json (Local).")

    # Mở trang tính bằng tên bạn đã tạo trong Google Drive
    spreadsheet = gc.open("Parkinson App Results")
    # Chọn sheet (trang tính) đầu tiên
    worksheet = spreadsheet.sheet1
    print("Đã kết nối thành công với Google Sheets.")
except Exception as e:
    print(f"LỖI: Không thể kết nối với Google Sheets. Lỗi: {e}")

# Các hằng số
QUIZ_POINTS_MAP = { "A. Không": 0, "B. Thi thoảng": 1, "C. Thường xuyên": 2 }


# --- CÁC HÀM HỖ TRỢ ---
def save_to_google_sheet(data):
    """
    Lưu một dòng kết quả mới vào Google Sheets.
    Hàm này đã được nâng cấp để bỏ qua các dòng trống.
    """
    if not worksheet:
        print("Bỏ qua việc lưu vì không kết nối được với Google Sheets.")
        return

    try:
        all_rows = worksheet.get_all_values()
        
        # Nếu sheet trống, thêm hàng tiêu đề
        if not all_rows:
            headers = [
                'bệnh nhân số', 'thời gian đo', 'điểm bảng câu hỏi', 
                'câu trả lời từng câu hỏi', 'tần số run', 
                'bảng tần số run', 'bảng biên độ run'
            ]
            worksheet.append_row(headers)
            all_rows.append(headers) # Cập nhật lại biến all_rows để tính ID
            print("Đã thêm hàng tiêu đề vào Google Sheet.")

        # Tìm dòng dữ liệu cuối cùng, bỏ qua các dòng trống có thể có ở cuối
        last_data_row = None
        for row in reversed(all_rows):
            if row and row[0]:  # Một hàng được coi là có dữ liệu nếu ô đầu tiên không trống
                last_data_row = row
                break
        
        # Tạo mã bệnh nhân mới
        new_id = "0001" # Mặc định nếu chưa có dữ liệu
        if last_data_row:
            last_id_str = last_data_row[0]
            # Chỉ tính toán nếu ID cuối cùng là một số (để tránh hàng tiêu đề)
            if last_id_str.isdigit():
                new_id = f"{int(last_id_str) + 1:04d}"

        # Chuẩn bị dữ liệu cho hàng mới theo đúng thứ tự của tiêu đề
        new_row = [
            new_id,
            data.get('thời gian đo'),
            data.get('điểm bảng câu hỏi'),
            data.get('câu trả lời từng câu hỏi'),
            data.get('tần số run'),
            data.get('bảng tần số run'),
            data.get('bảng biên độ run')
        ]
        
        worksheet.append_row(new_row)
        print(f"Đã lưu kết quả cho bệnh nhân số: {new_id} vào Google Sheets.")

    except Exception as e:
        print(f"Lỗi khi ghi dữ liệu vào Google Sheets: {e}")


def butter_bandpass_filter(data, lowcut, highcut, fs, order=4):
    """Hàm lọc tín hiệu."""
    nyquist = 0.5 * fs
    low = lowcut / nyquist
    high = highcut / nyquist
    b, a = signal.butter(order, [low, high], btype='band')
    y = signal.filtfilt(b, a, data)
    return y


# === CÁC ROUTE VÀ API ===

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/api/submit_quiz', methods=['POST'])
def submit_quiz():
    answers = request.get_json().get('answers')
    if not answers:
        return jsonify({'error': 'Không có câu trả lời nào được cung cấp'}), 400
    score = sum(QUIZ_POINTS_MAP.get(value, 0) for value in answers.values())
    return jsonify({'score': score})

@app.route('/api/analyze_tremor', methods=['POST'])
def analyze_tremor():
    data = request.get_json()
    tremor_data = data.get('tremor_data')
    quiz_data = data.get('quiz_data')

    if not tremor_data or not quiz_data:
        return jsonify({'error': 'Thiếu dữ liệu run hoặc quiz'}), 400

    time_series = tremor_data.get('time_series')
    duration = tremor_data.get('duration')
    if not time_series or not duration or duration <= 0 or len(time_series) < 20:
        return jsonify({'error': 'Dữ liệu run không đủ hoặc không hợp lệ'}), 400

    fs = len(time_series) / duration
    MIN_SAMPLING_RATE = 20.0

    if fs <= MIN_SAMPLING_RATE:
        error_message = f'Tần số lấy mẫu quá thấp ({fs:.2f} Hz). Cần phải lớn hơn {MIN_SAMPLING_RATE} Hz để có thể lọc trong dải tần 2-10 Hz. Vui lòng thử lại với video/camera có chất lượng tốt hơn.'
        return jsonify({'error': 'Dữ liệu không đủ chất lượng', 'message': error_message}), 400
    
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

    excel_data = {
        'thời gian đo': datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        'điểm bảng câu hỏi': quiz_data.get('score'),
        'câu trả lời từng câu hỏi': json.dumps(quiz_data.get('answers'), ensure_ascii=False),
        'tần số run': f"{peak_freq:.2f}",
        'bảng tần số run': json.dumps([round(f, 2) for f in freqs.tolist()]),
        'bảng biên độ run': json.dumps([round(a, 4) for a in amplitudes.tolist()])
    }
    save_to_google_sheet(excel_data)
    
    time_axis = np.linspace(0, duration, n)
    
    return jsonify({
        'peak_frequency': peak_freq,
        'conclusion': { 'text': conclusion_text, 'color': conclusion_color },
        'time_domain_data': { 'time_axis': time_axis.tolist(), 'signal': filtered_signal.tolist() },
        'frequency_domain_data': { 'frequencies': freqs.tolist(), 'amplitudes': amplitudes.tolist() }
    })

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