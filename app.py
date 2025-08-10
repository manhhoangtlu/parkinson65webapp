import os
import json
from datetime import datetime
from flask import Flask, render_template, request, jsonify, session, redirect, url_for
from dotenv import load_dotenv
import numpy as np
from scipy import signal
import google.generativeai as genai
import gspread
from werkzeug.security import generate_password_hash, check_password_hash

# --- KHỞI TẠO VÀ CẤU HÌNH ---
load_dotenv()
app = Flask(__name__)

app.secret_key = os.getenv("FLASK_SECRET_KEY", os.urandom(24))

# Cấu hình Google Gemini
model = None
try:
    genai.configure(api_key=os.getenv("GOOGLE_API_KEY"))
    model = genai.GenerativeModel('gemini-1.5-flash')
    print("✅ Đã kết nối với Google Gemini API.")
except Exception as e:
    print(f"❌ Lỗi khi cấu hình Gemini API: {e}")

# Cấu hình Google Sheets
results_sheet = None
users_sheet = None
try:
    creds_json_str = os.getenv("GSPREAD_CREDENTIALS")
    if creds_json_str:
        creds_dict = json.loads(creds_json_str)
        gc = gspread.service_account_from_dict(creds_dict)
        print("✅ Xác thực Google Sheets từ biến môi trường (Render/Production).")
    else:
        gc = gspread.service_account(filename='credentials.json')
        print("✅ Xác thực Google Sheets từ file credentials.json (Local).")

    spreadsheet = gc.open("Parkinson App Results")
    results_sheet = spreadsheet.worksheet("Results") # Sheet lưu kết quả đo
    users_sheet = spreadsheet.worksheet("Users")     # Sheet lưu thông tin người dùng
    print("✅ Đã kết nối thành công với cả 2 sheet 'Results' và 'Users'.")
except Exception as e:
    print(f"❌ LỖI: Không thể kết nối với Google Sheets. Lỗi: {e}")

# Các hằng số
QUIZ_POINTS_MAP = { "A. Không": 0, "B. Thi thoảng": 1, "C. Thường xuyên": 2 }


# --- CÁC HÀM HỖ TRỢ ---

def save_to_google_sheet(data):
    """Lưu một dòng kết quả mới vào sheet 'Results'."""
    if not results_sheet:
        print("⚠️  Bỏ qua việc lưu vì không kết nối được với Google Sheets.")
        return

    try:
        # Lấy tất cả các hàng để xác định tiêu đề và ID tiếp theo
        all_rows = results_sheet.get_all_values()
        
        headers = [
            'bệnh nhân số', 'thời gian đo', 'số điện thoại', 'họ và tên', 'điểm bảng câu hỏi', 
            'câu trả lời từng câu hỏi', 'tần số run', 'bảng tần số run', 'bảng biên độ run'
        ]

        # Nếu sheet trống, thêm hàng tiêu đề
        if not all_rows:
            results_sheet.append_row(headers)
            print("📝 Đã thêm hàng tiêu đề vào sheet 'Results'.")
            last_id_num = 0
        else:
            # Lấy ID từ hàng dữ liệu cuối cùng (bỏ qua tiêu đề)
            last_id_str = all_rows[-1][0] if len(all_rows) > 1 else '0'
            last_id_num = int(last_id_str) if last_id_str.isdigit() else 0
            
        new_id = f"{last_id_num + 1:04d}"

        # Chuẩn bị dữ liệu cho hàng mới
        new_row = [
            new_id,
            data.get('thời gian đo'),
            data.get('số điện thoại'),
            data.get('họ và tên'),
            data.get('điểm bảng câu hỏi'),
            data.get('câu trả lời từng câu hỏi'),
            data.get('tần số run'),
            data.get('bảng tần số run'),
            data.get('bảng biên độ run')
        ]
        
        results_sheet.append_row(new_row)
        print(f"💾 Đã lưu kết quả cho phiên số: {new_id} vào Google Sheets.")

    except Exception as e:
        print(f"❌ Lỗi khi ghi dữ liệu vào Google Sheets: {e}")


def butter_bandpass_filter(data, lowcut, highcut, fs, order=4):
    """Hàm lọc tín hiệu."""
    nyquist = 0.5 * fs
    low = lowcut / nyquist
    high = highcut / nyquist
    b, a = signal.butter(order, [low, high], btype='band')
    y = signal.filtfilt(b, a, data)
    return y


# === ROUTE CHO CÁC TRANG (GIAO DIỆN) ===

@app.route('/')
def home():
    """Trang chủ - Điều hướng dựa trên trạng thái đăng nhập."""
    if 'user_phone' in session:
        return redirect(url_for('main_app'))
    return redirect(url_for('login_page'))

@app.route('/login')
def login_page():
    """Hiển thị trang đăng nhập."""
    if 'user_phone' in session: # Nếu đã đăng nhập, vào thẳng app
        return redirect(url_for('main_app'))
    return render_template('login.html')

@app.route('/register')
def register_page():
    """Hiển thị trang đăng ký."""
    return render_template('register.html')

@app.route('/app')
def main_app():
    """Trang ứng dụng chính, yêu cầu đăng nhập."""
    if 'user_phone' not in session:
        return redirect(url_for('login_page'))
    
    # Lấy tên người dùng để hiển thị lời chào
    user_name = session.get('user_name', 'Người dùng')
    return render_template('index.html', user_name=user_name)

# === API CHO CHỨC NĂNG ĐĂNG NHẬP/ĐĂNG KÝ ===

@app.route("/api/register", methods=["POST"])
def api_register():
    data = request.get_json()
    phone = data.get("phone")
    full_name = data.get("fullName")
    address = data.get("address")
    password = data.get("password")

    if not all([phone, full_name, password]):
        return jsonify({"success": False, "message": "Vui lòng điền các trường bắt buộc."}), 400

    if users_sheet.find(phone):
        return jsonify({"success": False, "message": "Số điện thoại này đã được đăng ký."}), 409

    password_hash = generate_password_hash(password)
    new_user_row = [phone, full_name, address, password_hash]
    users_sheet.append_row(new_user_row)
    return jsonify({"success": True, "message": "Đăng ký thành công!"})

@app.route("/api/login", methods=["POST"])
def api_login():
    data = request.get_json()
    phone = data.get("phone")
    password = data.get("password")

    user_record = users_sheet.find(phone)
    if not user_record:
        return jsonify({"success": False, "message": "Số điện thoại hoặc mật khẩu không đúng."}), 401

    stored_hash = users_sheet.cell(user_record.row, 4).value
    if check_password_hash(stored_hash, password):
        session['user_phone'] = phone
        session['user_name'] = users_sheet.cell(user_record.row, 2).value
        return jsonify({"success": True, "message": "Đăng nhập thành công."})
    else:
        return jsonify({"success": False, "message": "Số điện thoại hoặc mật khẩu không đúng."}), 401

@app.route('/api/logout')
def api_logout():
    session.clear()
    return redirect(url_for('login_page'))


# === API CHO CÁC CHỨC NĂNG CHÍNH CỦA APP ===

@app.route('/api/submit_quiz', methods=['POST'])
def submit_quiz():
    if 'user_phone' not in session:
        return jsonify({'error': 'Yêu cầu đăng nhập'}), 401

    data = request.get_json()
    answers = data.get('answers')
    if not answers:
        return jsonify({'error': 'Không có câu trả lời nào được cung cấp'}), 400
    
    score = sum(QUIZ_POINTS_MAP.get(value, 0) for value in answers.values())
    return jsonify({'score': score})

@app.route('/api/analyze_tremor', methods=['POST'])
def analyze_tremor():
    if 'user_phone' not in session:
        return jsonify({'error': 'Yêu cầu đăng nhập'}), 401
        
    data = request.get_json()
    tremor_data = data.get('tremor_data')
    quiz_data = data.get('quiz_data')

    if not tremor_data or not quiz_data:
        return jsonify({'error': 'Thiếu dữ liệu run hoặc quiz'}), 400
    
    # Xử lý và phân tích tín hiệu run
    time_series = tremor_data.get('time_series')
    duration = tremor_data.get('duration')
    if not time_series or not duration or duration <= 0 or len(time_series) < 20:
        return jsonify({'error': 'Dữ liệu run không đủ hoặc không hợp lệ'}), 400

    fs = len(time_series) / duration
    if fs <= 20.0:
        error_message = f'Tần số lấy mẫu quá thấp ({fs:.2f} Hz). Cần > 20 Hz để phân tích. Vui lòng thử lại với camera chất lượng tốt hơn.'
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

    # Chuẩn bị dữ liệu và lưu vào Google Sheet
    excel_data = {
        'thời gian đo': datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        'số điện thoại': session['user_phone'],
        'họ và tên': session.get('user_name'),
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
    if 'user_phone' not in session:
        return jsonify({'error': 'Yêu cầu đăng nhập'}), 401
    if not model:
        return jsonify({'error': 'Dịch vụ AI chưa được cấu hình'}), 500
        
    prompt = request.get_json().get('prompt')
    if not prompt:
        return jsonify({'error': 'Prompt là bắt buộc'}), 400
        
    try:
        response = model.generate_content(prompt)
        return jsonify({'text': response.text})
    except Exception as e:
        print(f"❌ Lỗi khi gọi Gemini API: {e}")
        return jsonify({'error': 'Không thể gọi dịch vụ AI'}), 500

@app.route('/api/get_history', methods=['GET'])
def get_history():
    """
    Lấy tất cả các lượt đo trong quá khứ của người dùng đang đăng nhập.
    (Phiên bản nâng cấp để xử lý sheet có cột trống)
    """
    if 'user_phone' not in session:
        return jsonify({'error': 'Yêu cầu đăng nhập'}), 401

    try:
        user_phone = session['user_phone']
        print(f"Đang tìm lịch sử cho SĐT: {user_phone}")

        # >>> SỬA LỖI: Dùng get_all_values() thay vì get_all_records()
        all_values = results_sheet.get_all_values()

        # Nếu sheet trống hoặc chỉ có tiêu đề thì trả về danh sách rỗng
        if len(all_values) < 2:
            return jsonify([])

        headers = all_values[0]
        # Tìm vị trí của cột 'số điện thoại'
        try:
            phone_col_index = headers.index('số điện thoại')
        except ValueError:
            # Nếu không có cột 'số điện thoại' thì báo lỗi
            return jsonify({'error': 'Cấu trúc sheet "Results" không đúng, thiếu cột "số điện thoại".'}), 500

        user_history = []
        # Duyệt qua các hàng dữ liệu (bỏ qua hàng tiêu đề)
        for row in all_values[1:]:
            if len(row) > phone_col_index and row[phone_col_index] == user_phone:
                # Tạo một dictionary cho mỗi hàng tìm thấy
                record = dict(zip(headers, row))
                user_history.append(record)
        
        user_history.sort(key=lambda x: x.get('thời gian đo', ''), reverse=True)

        print(f"Đã tìm thấy {len(user_history)} lượt đo.")
        return jsonify(user_history)

    except Exception as e:
        print(f"❌ Lỗi khi lấy lịch sử: {e}")
        return jsonify({'error': 'Không thể lấy dữ liệu lịch sử từ máy chủ.'}), 500

@app.route('/api/analyze_history', methods=['POST'])
def analyze_history():
    """
    Nhận dữ liệu lịch sử và dùng AI để phân tích sự tiến triển.
    """
    if 'user_phone' not in session:
        return jsonify({'error': 'Yêu cầu đăng nhập'}), 401

    if not model:
        return jsonify({'error': 'Dịch vụ AI chưa được cấu hình'}), 500

    history_data = request.get_json().get('history')
    if not history_data or len(history_data) < 2:
        return jsonify({'error': 'Cần ít nhất 2 lượt đo để phân tích tiến triển.'}), 400

    # Xây dựng một prompt chi tiết cho AI
    prompt_details = "Dưới đây là lịch sử các kết quả đo của một người dùng để sàng lọc bệnh Parkinson, được sắp xếp từ mới nhất đến cũ nhất:\n\n"
    for record in history_data:
        prompt_details += (
            f"- Ngày đo: {record.get('thời gian đo')}\n"
            f"  - Điểm câu hỏi: {record.get('điểm bảng câu hỏi')}\n"
            f"  - Tần số run đo được: {record.get('tần số run')} Hz\n\n"
        )
    
    prompt_instructions = (
        "Dựa trên dữ liệu trên, hãy đóng vai một trợ lý y tế ảo và viết một bản phân tích ngắn gọn bằng tiếng Việt về sự tiến triển của người dùng theo thời gian. "
        "Hãy tập trung vào các điểm sau:\n"
        "1. Xu hướng của 'Điểm câu hỏi' (tăng, giảm hay ổn định?).\n"
        "2. Xu hướng của 'Tần số run' (có ổn định trong khoảng 4-7Hz không? có thay đổi đáng kể không?).\n"
        "3. Đưa ra một nhận xét tổng quan về việc các triệu chứng có vẻ đang nặng lên, nhẹ đi hay không thay đổi.\n"
        "4. Kết thúc bằng lời khuyên nên tham khảo ý kiến bác sĩ chuyên khoa để có đánh giá chính xác nhất. Nhấn mạnh rằng đây không phải là chẩn đoán y tế.\n"
        "Hãy trình bày một cách thân thiện, rõ ràng và dùng định dạng Markdown."
    )

    full_prompt = prompt_details + prompt_instructions

    try:
        response = model.generate_content(full_prompt)
        return jsonify({'analysis': response.text})
    except Exception as e:
        print(f"❌ Lỗi khi gọi Gemini API để phân tích lịch sử: {e}")
        return jsonify({'error': 'Không thể tạo phân tích từ AI.'}), 500

# Chạy ứng dụng
if __name__ == '__main__':
    app.run(debug=True, port=os.getenv("PORT", 5000))