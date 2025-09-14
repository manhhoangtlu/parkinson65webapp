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
from werkzeug.utils import secure_filename
from tensorflow.keras.models import load_model
from tensorflow.keras.preprocessing import image
import numpy as np

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

mri_model = None
try:
    # Đảm bảo bạn có một thư mục 'models' và đặt tệp .h5 vào đó
    mri_model = load_model('models/mri_model.h5') 
    print("✅ Đã tải thành công mô hình MRI.")
except Exception as e:
    print(f"❌ LỖI: Không thể tải mô hình MRI: {e}")

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
    """
    Lưu một dòng kết quả mới vào sheet 'Results'.
    ĐÃ CẬP NHẬT để bao gồm các cột chẩn đoán AI.
    """
    if not results_sheet:
        print("⚠️  Bỏ qua việc lưu vì không kết nối được với Google Sheets.")
        return

    try:
        all_rows = results_sheet.get_all_values()
        
        # *** THAY ĐỔI 1: Thêm 2 cột mới vào headers ***
        headers = [
            'bệnh nhân số', 'thời gian đo', 'số điện thoại', 'họ và tên', 'điểm bảng câu hỏi', 
            'câu trả lời từng câu hỏi', 'tần số run', 'bảng tần số run', 'bảng biên độ run',
            'loại chẩn đoán AI', 'kết quả chẩn đoán AI'
        ]

        if not all_rows:
            results_sheet.append_row(headers)
            print("📝 Đã thêm hàng tiêu đề vào sheet 'Results'.")
            last_id_num = 0
        else:
            last_id_str = all_rows[-1][0] if len(all_rows) > 1 else '0'
            last_id_num = int(last_id_str) if last_id_str.isdigit() else 0
            
        new_id = f"{last_id_num + 1:04d}"

        # *** THAY ĐỔI 2: Thêm 2 giá trị mới vào hàng dữ liệu ***
        new_row = [
            new_id,
            data.get('thời gian đo', ''),
            data.get('số điện thoại', ''),
            data.get('họ và tên', ''),
            data.get('điểm bảng câu hỏi', ''),
            data.get('câu trả lời từng câu hỏi', ''),
            data.get('tần số run', ''),
            data.get('bảng tần số run', ''),
            data.get('bảng biên độ run', ''),
            data.get('loại chẩn đoán AI', ''), # Dữ liệu cho cột mới
            data.get('kết quả chẩn đoán AI', '')  # Dữ liệu cho cột mới
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
# (Phần này giữ nguyên, không thay đổi)
@app.route('/')
def home():
    if 'user_phone' in session:
        return redirect(url_for('main_app'))
    return redirect(url_for('login_page'))

@app.route('/login')
def login_page():
    if 'user_phone' in session:
        return redirect(url_for('main_app'))
    return render_template('login.html')

@app.route('/register')
def register_page():
    return render_template('register.html')

@app.route('/app')
def main_app():
    if 'user_phone' not in session:
        return redirect(url_for('login_page'))
    user_name = session.get('user_name', 'Người dùng')
    return render_template('index.html', user_name=user_name)

# === API CHO CHỨC NĂNG ĐĂNG NHẬP/ĐĂNG KÝ ===
# (Phần này giữ nguyên, không thay đổi)
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
# (Phần này giữ nguyên, không thay đổi)
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

    # *** THAY ĐỔI 3: Thêm 2 trường mới vào excel_data ***
    excel_data = {
        'thời gian đo': datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        'số điện thoại': session['user_phone'],
        'họ và tên': session.get('user_name'),
        'điểm bảng câu hỏi': quiz_data.get('score'),
        'câu trả lời từng câu hỏi': json.dumps(quiz_data.get('answers'), ensure_ascii=False),
        'tần số run': f"{peak_freq:.2f}",
        'bảng tần số run': json.dumps([round(f, 2) for f in freqs.tolist()]),
        'bảng biên độ run': json.dumps([round(a, 4) for a in amplitudes.tolist()]),
        'loại chẩn đoán AI': 'Phân tích độ run', # <-- Dữ liệu mới
        'kết quả chẩn đoán AI': conclusion_text # <-- Dữ liệu mới
    }
    save_to_google_sheet(excel_data)
    
    time_axis = np.linspace(0, duration, n)
    
    return jsonify({
        'peak_frequency': peak_freq,
        'conclusion': { 'text': conclusion_text, 'color': conclusion_color },
        'time_domain_data': { 'time_axis': time_axis.tolist(), 'signal': filtered_signal.tolist() },
        'frequency_domain_data': { 'frequencies': freqs.tolist(), 'amplitudes': amplitudes.tolist() }
    })

# (Các API ai_summary, get_history, analyze_history giữ nguyên, không thay đổi)
@app.route('/api/ai_summary', methods=['POST'])
def ai_summary():
    # ... (Giữ nguyên)
    pass

@app.route('/api/get_history', methods=['GET'])
def get_history():
    # ... (Giữ nguyên)
    pass

@app.route('/api/analyze_history', methods=['POST'])
def analyze_history():
    # ... (Giữ nguyên)
    pass

#api mri     
def preprocess_mri_image(img_path, target_size=(224, 224)):
    """Hàm tiền xử lý ảnh MRI cho phù hợp với đầu vào của mô hình."""
    img = image.load_img(img_path, target_size=target_size, color_mode="grayscale")#color_mode="grayscale"
    img_array = image.img_to_array(img)
    img_array = np.expand_dims(img_array, axis=0)
    img_array /= 255.0
    return img_array

@app.route('/api/predict_mri', methods=['POST'])
def predict_mri():
    if 'user_phone' not in session:
        return jsonify({'error': 'Yêu cầu đăng nhập'}), 401
    
    if not mri_model:
        return jsonify({'error': 'Mô hình MRI chưa sẵn sàng'}), 503

    if 'file' not in request.files:
        return jsonify({'error': 'Không có tệp nào được gửi lên'}), 400

    file = request.files['file']
    if file.filename == '':
        return jsonify({'error': 'Tệp không có tên'}), 400

    try:
        # Tạo thư mục uploads nếu chưa có
        upload_folder = 'uploads'
        if not os.path.exists(upload_folder):
            os.makedirs(upload_folder)

        # Lưu tệp tạm thời
        filename = secure_filename(file.filename)
        filepath = os.path.join(upload_folder, filename)
        file.save(filepath)

        # Tiền xử lý ảnh và dự đoán
        processed_image = preprocess_mri_image(filepath)
        prediction = mri_model.predict(processed_image)
        
        # Xóa tệp sau khi xử lý
        os.remove(filepath)

        # Xử lý kết quả đầu ra
        confidence_raw = float(prediction[0][0])
        
        if confidence_raw > 0.5:
            conclusion_text = "Có dấu hiệu Parkinson"
            confidence_percent = f"{confidence_raw * 100:.2f}%"
        else:
            conclusion_text = "Không phát hiện dấu hiệu Parkinson"
            confidence_percent = f"{(1 - confidence_raw) * 100:.2f}%"
        
        # --- PHẦN THÊM MỚI ĐỂ LƯU KẾT QUẢ ---
        
        # 1. Tạo chuỗi kết quả đầy đủ để lưu
        full_result_for_sheet = f"{conclusion_text} (Độ chắc chắn: {confidence_percent})"

        # 2. Chuẩn bị dữ liệu dưới dạng dictionary
        excel_data = {
            'thời gian đo': datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
            'số điện thoại': session.get('user_phone'),
            'họ và tên': session.get('user_name'),
            # Các trường không liên quan đến MRI có thể để trống
            'điểm bảng câu hỏi': '',
            'câu trả lời từng câu hỏi': '',
            'tần số run': '',
            'bảng tần số run': '',
            'bảng biên độ run': '',
            # Điền thông tin chẩn đoán MRI
            'loại chẩn đoán AI': 'Phân tích MRI',
            'kết quả chẩn đoán AI': full_result_for_sheet
        }

        # 3. Gọi hàm để lưu dữ liệu vào Google Sheet
        save_to_google_sheet(excel_data)

        return jsonify({
            'conclusion': conclusion_text,
            'confidence': confidence_percent
        })

    except Exception as e:
        print(f"❌ Lỗi khi phân tích MRI: {e}")
        # Đảm bảo xóa tệp nếu có lỗi
        if 'filepath' in locals() and os.path.exists(filepath):
            os.remove(filepath)
        return jsonify({'error': 'Đã xảy ra lỗi trong quá trình phân tích'}), 500

# Chạy ứng dụng
if __name__ == '__main__':
    app.run(debug=True, port=os.getenv("PORT", 5000))