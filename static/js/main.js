import {
    HandLandmarker,
    FilesetResolver,
    DrawingUtils
} from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/vision_bundle.js";

const PALM_CONNECTIONS = [{start: 0, end: 1}, {start: 0, end: 5}, {start: 5, end: 9}, {start: 9, end: 13}, {start: 13, end: 17}, {start: 0, end: 17}];
const THUMB_CONNECTIONS = [{start: 1, end: 2}, {start: 2, end: 3}, {start: 3, end: 4}];
const INDEX_CONNECTIONS = [{start: 5, end: 6}, {start: 6, end: 7}, {start: 7, end: 8}];
const MIDDLE_CONNECTIONS = [{start: 9, end: 10}, {start: 10, end: 11}, {start: 11, end: 12}];
const RING_CONNECTIONS = [{start: 13, end: 14}, {start: 14, end: 15}, {start: 15, end: 16}];
const PINKY_CONNECTIONS = [{start: 17, end: 18}, {start: 18, end: 19}, {start: 19, end: 20}];

const FINGER_COLORS = {
    palm: '#E0E0E0',     // Màu xám nhạt cho lòng bàn tay
    thumb: '#FBC02D',    // Màu cam vàng cho ngón cái
    index: '#0288D1',    // Màu xanh dương cho ngón trỏ
    middle: '#388E3C',   // Màu xanh lá cho ngón giữa
    ring: '#FFEB3B',     // Màu vàng cho ngón áp út
    pinky: '#9C27B0',     // Màu tím cho ngón út
    base: '#D32F2F'      // Màu ĐỎ cho các khớp nối gốc
};

document.addEventListener('DOMContentLoaded', () => {

    const mainContentArea = document.getElementById('main-content-area');
    const navButtons = document.querySelectorAll('.nav-btn');
    let currentView = 'welcome';

    const appState = {
        quizResult: null,
        diagnosisResult: null
    };

    let handLandmarker = null;
    let isModelReady = false;
    let video;
    let canvasElement;
    let canvasCtx;
    let drawingUtils;
    let lastVideoTime = -1;
    let animationFrameId;
    const ANALYSIS_DURATION_MS = 15000;
    let allFingerMovementData = {};
    let analysisStartTime = null;

    let gammaChart = null;
    let tremorChart = null;
    let fftChart = null;
    let map = null;

    const quizQuestions = [
        {"text": "1. Cô/chú có thường xuyên bị run tay khi nghỉ ngơi?", "options": ["A. Không", "B. Thi thoảng", "C. Thường xuyên"], "key": "rest_tremor"},
        {"text": "2. Cô/chú có cảm thấy cứng cơ hoặc khó cử động các khớp?", "options": ["A. Không", "B. Thi thoảng", "C. Thường xuyên"], "key": "rigidity"},
        {"text": "3. Khi đi bộ, Cô/chú có cảm giác bị kéo chân hoặc bước đi ngắn và chậm lại không?", "options": ["A. Không", "B. Thi thoảng", "C. Thường xuyên"], "key": "bradykinesia"},
        {"text": "4. Cô/chú có khi nào bị khựng lại đột ngột khi đang đi?", "options": ["A. Không", "B. Thi thoảng", "C. Thường xuyên"], "key": "freezing_gait"},
        {"text": "5. Cô/chú có thấy giảm biểu cảm khuôn mặt?", "options": ["A. Không", "B. Thi thoảng", "C. Thường xuyên"], "key": "masked_face"},
        {"text": "6. Cô/chú có gặp khó khăn khi viết chữ, chữ nhỏ dần?", "options": ["A. Không", "B. Thi thoảng", "C. Thường xuyên"], "key": "micrographia"},
        {"text": "7. Cô/chú có gặp tình trạng táo bón kéo dài?", "options": ["A. Không", "B. Thi thoảng", "C. Thường xuyên"], "key": "constipation"},
        {"text": "8. Cô/chú có thấy mình bị giảm khả năng ngửi mùi?", "options": ["A. Không", "B. Thi thoảng", "C. Thường xuyên"], "key": "hyposmia"},
        {"text": "9. Cô/chú có bị rối loạn giấc ngủ, ví dụ như ngã khỏi giường?", "options": ["A. Không", "B. Thi thoảng", "C. Thường xuyên"], "key": "sleep_disorder"},
        {"text": "10. Cô/chú có cảm thấy mệt mỏi bất thường dù ngủ đủ giấc?", "options": ["A. Không", "B. Thi thoảng", "C. Thường xuyên"], "key": "fatigue"},
        {"text": "11. Cô/chú có gặp trầm cảm nhẹ hoặc cảm giác chán nản?", "options": ["A. Không", "B. Thi thoảng", "C. Thường xuyên"], "key": "depression"},
        {"text": "12. Cô/chú có bị giảm trí nhớ nhẹ hoặc khó tập trung?", "options": ["A. Không", "B. Thi thoảng", "C. Thường xuyên"], "key": "cognitive_issues"},
        {"text": "13. Cô/chú có gặp khó khăn trong việc mặc quần áo, ăn uống?", "options": ["A. Không", "B. Thi thoảng", "C. Thường xuyên"], "key": "dressing_eating_difficulty"},
        {"text": "14. Cô/chú có bị khó giữ thăng bằng, dễ vấp ngã?", "options": ["A. Không", "B. Thi thoảng", "C. Thường xuyên"], "key": "balance_issues"},
        {"text": "15. Cô/chú có đang sử dụng thuốc điều trị thần kinh hoặc được chẩn đoán Parkinson?", "options": ["A. Không", "B. Thi thoảng", "C. Thường xuyên"], "key": "medication_diagnosis"}
    ];
    const FINGER_DEFINITIONS = { 'NGÓN TRỎ': 8, 'NGÓN GIỮA': 12, 'NGÓN ÁP ÚT': 16, 'NGÓN ÚT': 20 };

    const modal = document.getElementById('messageModal');
    const modalTitle = document.getElementById('modalTitle');
    const modalMessage = document.getElementById('modalMessage');
    const modalCloseBtn = document.getElementById('modalCloseBtn');
    
    function showModal(title, message, isLoading = false) {
        modalTitle.textContent = title;
        modalMessage.innerHTML = message;
        modalCloseBtn.style.display = isLoading ? 'none' : 'block';
        modalCloseBtn.onclick = hideModal;
        modal.style.display = 'flex';
    }
    function hideModal() { modal.style.display = 'none'; }
    window.onclick = (event) => { if (event.target == modal) hideModal(); };

    async function callAIAssistant(prompt) {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 30000);
        try {
            const response = await fetch('/api/ai_summary', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ prompt: prompt }),
                signal: controller.signal
            });
            clearTimeout(timeoutId);
            if (!response.ok) throw new Error('Phản hồi từ máy chủ không hợp lệ.');
            const result = await response.json();
            return result.text;
        } catch (error) {
            console.error("AI call failed:", error);
            if (error.name === 'AbortError') {
                return "Máy chủ AI mất quá nhiều thời gian để phản hồi. Vui lòng thử lại sau.";
            }
            return "Lỗi kết nối đến trợ lý AI.";
        }
    }

    async function handleAiQuizAnalysis() {
        const btn = document.getElementById('ai-analysis-btn');
        if (!appState.quizResult) return;
        
        btn.disabled = true;
        btn.innerHTML = `✨ Đang phân tích...`;
        showModal("✨ Phân tích từ AI", `<div class="text-center"><p>Vui lòng chờ...</p><div class="w-16 h-16 border-4 border-dashed rounded-full animate-spin border-purple-500 mx-auto mt-4"></div></div>`, true);

        let answersString = Object.entries(appState.quizResult.answers)
            .filter(([key]) => key !== 'userName')
            .map(([key, answer]) => `- ${quizQuestions.find(q => q.key === key).text}: ${answer}`)
            .join('\n');
        
        const prompt = `Một người dùng đã hoàn thành bảng câu hỏi sàng lọc Parkinson với điểm số ${appState.quizResult.score}. Chi tiết câu trả lời:\n${answersString}\n\nDựa trên dữ liệu này, hãy đưa ra bản tóm tắt thân thiện bằng tiếng Việt. Nhấn mạnh các triệu chứng nổi bật, và khuyến khích họ thảo luận với bác sĩ. Lưu ý rằng đây không phải là chẩn đoán y tế. Định dạng bằng Markdown.`;
        
        const aiResponse = await callAIAssistant(prompt);
        hideModal();
        showModal("✨ Phân tích từ AI", aiResponse.replace(/\n/g, '<br>'));
        btn.disabled = false;
        btn.innerHTML = `✨ Nhận phân tích chi tiết từ AI`;
    }

    async function handleAiDoctorPrep() {
        const btn = document.getElementById('ai-doctor-prep-btn');
        const contentDiv = document.getElementById('ai-assistant-content');
        if (!appState.quizResult || !appState.diagnosisResult) return;

        btn.disabled = true;
        btn.innerText = "Đang tạo gợi ý...";
        contentDiv.innerHTML = `<div class="w-8 h-8 border-4 border-dashed rounded-full animate-spin border-indigo-500 mx-auto"></div>`;

        const prompt = `Một người dùng chuẩn bị gặp bác sĩ về các triệu chứng Parkinson. Kết quả của họ là:\n- Điểm trắc nghiệm: ${appState.quizResult.score}\n- Tần số run tay đo được: ${appState.diagnosisResult.peakFrequency.toFixed(2)} Hz.\n\nHãy tạo danh sách gạch đầu dòng ngắn gọn bằng tiếng Việt, gồm các điểm chính và câu hỏi họ nên thảo luận với bác sĩ để giúp họ giao tiếp hiệu quả.`;
        const aiResponse = await callAIAssistant(prompt);
        const htmlResponse = '<ul>' + aiResponse.split('\n').filter(line => line.trim().startsWith('* ') || line.trim().startsWith('- ')).map(line => `<li>${line.substring(2)}</li>`).join('') + '</ul>';
        contentDiv.innerHTML = htmlResponse;
        btn.disabled = false;
        btn.innerText = "Tạo lại gợi ý";
    }

    function switchView(viewName) {
        currentView = viewName;
        stopAllActivities();
        mainContentArea.innerHTML = '';
        navButtons.forEach(btn => btn.classList.toggle('active', btn.dataset.view === viewName));
        const renderMap = {
            'welcome': renderWelcomeView,
            'quiz': renderQuizView,
            'diagnosis': renderDiagnosisView,
            'gamma': renderGammaView,
            'doctor': renderDoctorView,
            'team': renderTeamView,
            'baitap': renderBaitapView
        };
        (renderMap[viewName] || renderWelcomeView)();
    }

    function renderWelcomeView() {
        mainContentArea.innerHTML = `<div class="text-center"><h2 class="text-4xl font-bold text-gray-800 mb-4">Chào mừng!</h2><p class="text-lg text-gray-600">Chọn một chức năng để bắt đầu.</p></div>`;
    }

    function renderQuizView() {
        let currentQuestionIndex = 0;
        let userAnswers = {};
        
        function displayAskInfo() {
            mainContentArea.innerHTML = `<div class="w-full max-w-2xl bg-white p-8 rounded-xl shadow-lg"><p class="text-gray-500 mb-1">Thông tin</p><input id='user-name-input' type="text" placeholder="Nhập họ và tên..." class="w-full px-4 py-2 border border-gray-300 rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"/><button id="display-question-btn" class="mt-8 w-full bg-blue-600 text-white py-3 rounded-lg font-semibold hover:bg-blue-700">Bắt đầu</button></div>`;
            document.getElementById('display-question-btn').addEventListener('click', () => {
                const userNameInput = document.getElementById('user-name-input');
                if (userNameInput.value.trim() === "") {
                    showModal("Thông báo", "Vui lòng nhập họ và tên của bạn.");
                    return;
                }
                userAnswers['userName'] = userNameInput.value;
                displayQuestion();
            });
        }

        function displayQuestion() {
            const question = quizQuestions[currentQuestionIndex];
            mainContentArea.innerHTML = `<div class="w-full max-w-2xl bg-white p-8 rounded-xl shadow-lg"><p class="text-gray-500">Câu hỏi ${currentQuestionIndex + 1} / ${quizQuestions.length}</p><div class="w-full bg-gray-200 rounded-full h-2.5 mt-1"><div class="bg-blue-600 h-2.5 rounded-full" style="width: ${((currentQuestionIndex + 1) / quizQuestions.length) * 100}%"></div></div><h3 class="text-2xl font-semibold my-6 text-gray-800">${question.text}</h3><div class="space-y-4">${question.options.map((opt, index) => `<div><input type="radio" id="option${index}" name="quizOption" value="${index}" class="hidden peer"><label for="option${index}" class="block cursor-pointer select-none rounded-xl p-4 text-center text-gray-700 border-2 border-gray-300 peer-checked:bg-blue-500 peer-checked:font-bold peer-checked:text-white">${opt}</label></div>`).join('')}</div><button id="next-question-btn" class="mt-8 w-full bg-blue-600 text-white py-3 rounded-lg font-semibold hover:bg-blue-700">Tiếp theo</button></div>`;
            document.getElementById('next-question-btn').addEventListener('click', nextQuestion);
        }

        function nextQuestion() {
            const selectedOption = document.querySelector('input[name="quizOption"]:checked');
            if (!selectedOption) {
                showModal("Thông báo", "Vui lòng chọn một đáp án.");
                return;
            }
            userAnswers[quizQuestions[currentQuestionIndex].key] = quizQuestions[currentQuestionIndex].options[selectedOption.value];
            currentQuestionIndex++;
            if (currentQuestionIndex < quizQuestions.length) displayQuestion();
            else showQuizResults(userAnswers);
        }
        displayAskInfo();
    }

    async function showQuizResults(userAnswers) {
        showModal("Đang xử lý", "Đang gửi kết quả lên máy chủ...", true);
        const userName = userAnswers['userName'];
        try {
            const response = await fetch('/api/submit_quiz', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ answers: userAnswers, name: userName })
            });
            if (!response.ok) throw new Error('Lỗi khi gửi kết quả quiz.');
            const result = await response.json();
            
            appState.quizResult = { score: result.score, answers: userAnswers, name: userName }; 
            hideModal();

            const totalPossibleScore = (quizQuestions.length) * 2;
            let resultMessage = `Tổng điểm của cô/chú là: <strong>${result.score} / ${totalPossibleScore}</strong><br><br>${result.score > 6 ? "Dựa trên câu trả lời, có một số dấu hiệu của bệnh Parkinson. Vui lòng tham khảo ý kiến bác sĩ." : "Không nhận thấy các dấu hiệu rõ ràng. Tuy nhiên, nếu có bất kỳ lo lắng nào, hãy tham khảo ý kiến bác sĩ."}`;
            
            mainContentArea.innerHTML = `<div class="text-center w-full max-w-2xl bg-white p-8 rounded-xl shadow-lg"><h2 class="text-3xl font-bold text-gray-800 mb-4">Hoàn thành!</h2><p class="text-lg text-gray-600">${resultMessage}</p><div class="mt-8 space-x-4"><button id="restart-quiz-btn" class="bg-blue-600 text-white py-3 px-6 rounded-lg font-semibold hover:bg-blue-700">Làm lại</button><button id="ai-analysis-btn" class="bg-gradient-to-r from-purple-500 to-indigo-600 text-white py-3 px-6 rounded-lg font-semibold hover:opacity-90">✨ Nhận phân tích từ AI</button></div></div>`;
            document.getElementById('restart-quiz-btn').addEventListener('click', () => switchView('quiz'));
            document.getElementById('ai-analysis-btn').addEventListener('click', handleAiQuizAnalysis);
        } catch (error) {
            hideModal();
            showModal("Lỗi", "Không thể lấy điểm từ máy chủ.");
        }
    }

    function renderDiagnosisView() {
        mainContentArea.innerHTML = `<div class="w-full max-w-4xl bg-white p-8 rounded-xl shadow-lg text-center"><h2 class="text-3xl font-bold text-gray-800 mb-4">Chẩn đoán run tay</h2><p class="text-gray-600 mb-6">Sử dụng camera hoặc tải video lên để phân tích. Để có kết quả đầy đủ nhất, vui lòng hoàn thành 'Bộ câu hỏi' trước.</p><div id="diagnosis-controls" class="flex flex-wrap justify-center items-center gap-4"><button id="start-camera-btn" class="bg-blue-600 text-white py-2 px-5 rounded-lg font-semibold hover:bg-blue-700">Phân tích từ Camera</button><label for="video-upload" class="bg-purple-600 text-white py-2 px-5 rounded-lg font-semibold hover:bg-purple-700 cursor-pointer">Chọn file Video</label><input type="file" id="video-upload" class="hidden" accept="video/*"><button id="stop-btn" class="bg-red-600 text-white py-2 px-5 rounded-lg font-semibold hover:bg-red-700 hidden">Dừng</button></div><div id="status-message" class="text-blue-600 font-semibold my-4 h-12 flex items-center justify-center"></div><div class="relative w-full max-w-2xl mx-auto aspect-video bg-gray-900 rounded-lg overflow-hidden"><video id="webcam" class="absolute inset-0 w-full h-full" autoplay playsinline></video><canvas id="output_canvas" class="absolute inset-0 w-full h-full"></canvas></div><div id="charts-container" class="mt-8 grid md:grid-cols-2 gap-6"><div><h3 id="tremor-chart-title" class="font-semibold text-lg mb-2">Biên độ run theo thời gian</h3><canvas id="tremor-chart"></canvas></div><div><h3 class="font-semibold text-lg mb-2">Phân tích tần số (FFT)</h3><canvas id="fft-chart"></canvas></div></div><div id="final-actions-container" class="mt-6 flex justify-center items-center gap-4 hidden"><button id="reset-zoom-btn" class="bg-gray-500 text-white py-2 px-5 rounded-lg font-semibold hover:bg-gray-600">Reset Zoom</button><button id="download-results-btn" class="bg-sky-500 text-white py-2 px-5 rounded-lg font-semibold hover:bg-sky-600">Tải xuống Biểu đồ</button></div><div id="result-text" class="mt-6 text-2xl font-bold"></div></div>`;
        document.getElementById('status-message').innerText = isModelReady ? "Mô hình đã sẵn sàng." : "Đang tải mô hình...";
        document.getElementById('start-camera-btn').onclick = () => startDiagnosis('camera');
        document.getElementById('video-upload').onchange = (e) => startDiagnosis('video', e.target.files[0]);
        document.getElementById('stop-btn').onclick = stopAllActivities;
        video = document.getElementById("webcam");
        canvasElement = document.getElementById("output_canvas");
        canvasCtx = canvasElement.getContext("2d");
        drawingUtils = new DrawingUtils(canvasCtx);
        initializeTremorCharts();
    }
    
    function renderGammaView() {
        mainContentArea.innerHTML = `<div class="w-full max-w-4xl bg-white p-8 rounded-xl shadow-lg text-center"><h2 class="text-3xl font-bold text-gray-800 mb-4">Mô phỏng Phân tích Sóng não</h2><p class="text-gray-600 mb-6">Đây là màn hình mô phỏng dữ liệu sóng não EEG. Biểu đồ dưới đây tự động tạo ra dữ liệu để minh họa.</p><div class="w-full"><canvas id="gamma-chart"></canvas></div></div>`;
        startGammaSimulation();
    }

    function renderDoctorView() {
        mainContentArea.innerHTML = `<div class="w-full max-w-6xl bg-white p-8 rounded-xl shadow-lg grid md:grid-cols-2 gap-8"><div class="text-center md:text-left"><h2 class="text-3xl font-bold text-gray-800 mb-4">Liên hệ Bác sĩ</h2><p class="text-lg text-gray-700 mb-2">Để được tư vấn và chẩn đoán chính xác, vui lòng liên hệ các cơ sở y tế gần bạn.</p><div class="mt-4 space-y-3"><div class="bg-gray-100 p-4 rounded-lg"><p class="text-xl font-semibold text-blue-700">Bệnh Viện Bạch Mai</p><p class="text-md text-gray-600 mt-1"><strong>SĐT:</strong> 024 3869 3731</p><p class="text-md text-gray-600"><strong>Địa chỉ:</strong> 78 Đường Giải Phóng, Đống Đa, Hà Nội</p></div></div><div id="ai-assistant-container" class="mt-6 bg-indigo-50 p-4 rounded-lg"><h3 class="text-xl font-bold text-indigo-800 mb-2">✨ Trợ lý AI: Chuẩn bị cho buổi hẹn</h3><p class="text-gray-700 mb-4">Hoàn thành "Bộ câu hỏi" và "Chẩn đoán Run" để AI có thể đưa ra gợi ý hữu ích nhất.</p><button id="ai-doctor-prep-btn" class="bg-indigo-600 text-white py-2 px-5 rounded-lg font-semibold hover:bg-indigo-700 disabled:bg-gray-400">Tạo gợi ý thảo luận</button><div id="ai-assistant-content" class="mt-4 text-gray-800"></div></div></div><div id="map-container" class="w-full h-80 md:h-full rounded-lg overflow-hidden shadow-inner border bg-gray-200 flex items-center justify-center"><p id="map-placeholder" class="text-gray-500">Đang tải bản đồ...</p><div id="map" class="w-full h-full"></div></div></div>`;
        initMap();
        const prepButton = document.getElementById('ai-doctor-prep-btn');
        prepButton.disabled = !(appState.quizResult && appState.diagnosisResult);
        prepButton.addEventListener('click', handleAiDoctorPrep);
    }

    function renderTeamView() {
        mainContentArea.innerHTML = `<div class="w-full max-w-4xl mx-auto text-center p-4"><h2 class="text-3xl font-bold text-gray-800 mb-8">Thông tin Nhóm Nghiên cứu</h2><div class="mb-10"><h3 class="text-2xl font-semibold text-indigo-700 mb-4">Giảng viên hướng dẫn</h3><div class="inline-block bg-white p-6 rounded-xl shadow-lg transform hover:scale-105 transition-transform duration-300"><img src="https://scontent.fhan3-3.fna.fbcdn.net/v/t39.30808-6/486074380_3184971494975671_8009404921995578872_n.jpg?_nc_cat=111&ccb=1-7&_nc_sid=6ee11a&_nc_eui2=AeF1KWXe-F-BRHVQcWOpC2rxc2K6ryanBSdzYrqvJqcFJ5zRLmSO6a9jHx43fWM2w-FYQgHxGXrzUa-a7v2e87Dz&_nc_ohc=U4OI6134hUQQ7kNvwF3Jolc&_nc_oc=Adn4GjVOvBDOWEaLrLyRDn-Qc-3MrXpNKsiecfBLbbVvhPmVwdcf6piBKELdgWRA2LY&_nc_zt=23&_nc_ht=scontent.fhan3-3.fna&_nc_gid=MOrlqogMPLRhOggflYMQ7g&oh=00_AfQ1GYAkfwUX5rqjU9D9SuR9ESFNKRHBV6DMjpx__IBNiw&oe=688E1F2F" alt="Avatar giảng viên" class="w-24 h-24 rounded-full mx-auto mb-3 border-4 border-indigo-200 object-cover"><p class="text-xl font-bold text-gray-900">TS. Ngô Quang Vĩ</p><p class="text-md text-gray-600">Khoa Điện - Điện Tử</p></div></div><div><h3 class="text-2xl font-semibold text-purple-700 mb-6">Thành viên thực hiện</h3><div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-8"><div class="bg-white p-5 rounded-xl shadow-lg transform hover:scale-105 transition-transform duration-300"><img src="https://scontent.fhan4-3.fna.fbcdn.net/v/t39.30808-1/500608973_1463414898358865_7062293104784996257_n.jpg?stp=dst-jpg_s200x200_tt6&_nc_cat=110&ccb=1-7&_nc_sid=1d2534&_nc_eui2=AeGHzZkMeYStID6Go19RPANsp-NptLgcHAun42m0uBwcC4no-kBHWpVRqsVeLqJUFhjlqwc8WFTqmulPPcVDRIpR&_nc_ohc=T6Bm1XidUsMQ7kNvwG9wulD&_nc_oc=AdlaLDHwl6mRgTCBH59v-gyPA7BDuFBD4AYT4NHtVLRux8057GXFhuWjXnRbJr-qR5I&_nc_zt=24&_nc_ht=scontent.fhan4-3.fna&_nc_gid=FeeElU93q6OQfQSLxIbKyg&oh=00_AfRB3SPVLGBIsYRa0dewyUYWSUZkhP9UlBpBbxE2uCRf8w&oe=688E291B" alt="Avatar thành viên" class="w-20 h-20 rounded-full mx-auto mb-3 border-4 border-purple-100 object-cover"><p class="text-lg font-bold text-gray-800">Đinh Mạnh Hoàng</p><p class="text-sm text-gray-500">MSV: 2351281952</p></div><div class="bg-white p-5 rounded-xl shadow-lg transform hover:scale-105 transition-transform duration-300"><img src="https://scontent.fhan3-2.fna.fbcdn.net/v/t39.30808-1/495349752_694460336405766_1341353726955587676_n.jpg?stp=dst-jpg_s200x200_tt6&_nc_cat=107&ccb=1-7&_nc_sid=1d2534&_nc_eui2=AeEzsDJebXrJFx26AchBifza_MiZJjI3osb8yJkmMjeixoALF_J0MeSu2GBN5Db1Gh7UBttBQd0X9jkMfPIrzGqp&_nc_ohc=8TScy_KLaKEQ7kNvwHw1Zox&_nc_oc=Adl4Fe6cCHHSuedDHP_vSsfOkZwtBZSrPDyCmvE-Uzz0oKYT0zl8ErNtMOUI6W_DUIg&_nc_zt=24&_nc_ht=scontent.fhan3-2.fna&_nc_gid=LXQfvjobgX1J469N55mUJA&oh=00_AfSV_hAsidzdmhIizo2LNVvu5P2UeWLmVPdW_RRr2r4Cnw&oe=688E209F" alt="Avatar thành viên" class="w-20 h-20 rounded-full mx-auto mb-3 border-4 border-purple-100 object-cover"><p class="text-lg font-bold text-gray-800">Nguyễn Thị Quỳnh</p><p class="text-sm text-gray-500">MSV: 2351281974</p></div><div class="bg-white p-5 rounded-xl shadow-lg transform hover:scale-105 transition-transform duration-300"><img src="https://scontent.fhan3-4.fna.fbcdn.net/v/t39.30808-6/481055917_1172795004304698_5006080809306805812_n.jpg?_nc_cat=106&ccb=1-7&_nc_sid=a5f93a&_nc_eui2=AeFvtCuYDh-xm39dN9abJEyoliMt_7VWowyWIy3_tVajDCG15uljFw8_p-hB92Mg4hfJDICh8x3Nco52h96Wl_-f&_nc_ohc=6OeTG8Ux5kgQ7kNvwEdms0_&_nc_oc=AdlL2Qpu9FOKj780-bbBvzbmt6XtHetnNXlHf_iWGVhkaoNWaTT2DyZmMyxuodZEJMU&_nc_zt=23&_nc_ht=scontent.fhan3-4.fna&_nc_gid=S83P6cRSEyuyiEWL2YAPFA&oh=00_AfQrLI3CPA1r0bBMVRx9hWbcA6I5fHFr7fyAIy6CWsA29Q&oe=688E2E99" alt="Avatar thành viên" class="w-20 h-20 rounded-full mx-auto mb-3 border-4 border-purple-100 object-cover"><p class="text-lg font-bold text-gray-800">Lê Trung Hiếu</p><p class="text-sm text-gray-500">MSV: 2351281949</p></div><div class="bg-white p-5 rounded-xl shadow-lg transform hover:scale-105 transition-transform duration-300"><img src="https://scontent.fhan3-4.fna.fbcdn.net/v/t1.6435-9/70288778_104083377639385_3575547307413733376_n.jpg?_nc_cat=104&ccb=1-7&_nc_sid=6ee11a&_nc_eui2=AeH3_M6jvwOqSiQGNlgikxBaTBmy_hFR3nVMGbL-EVHedYku0WPtmEBLFH2BZvjf_iaenBnw2TawyiIskxH8k3lq&_nc_ohc=0lTt4LDkdOIQ7kNvwGYHlgs&_nc_oc=AdmeWrU5vmVFztdht8AyN8q9hZOBe69Yoh---FEM1uJHKDk9sjRSKGlMwYejvfx01U0&_nc_zt=23&_nc_ht=scontent.fhan3-4.fna&_nc_gid=4gruAKB13s6Bc7wezW5h6Q&oh=00_AfS3k0eFrm2Be43nwcT1i-LZDzDd-cx32P5_Wpd3hEXkdg&oe=68AFBF52" alt="Avatar thành viên" class="w-20 h-20 rounded-full mx-auto mb-3 border-4 border-purple-100 object-cover"><p class="text-lg font-bold text-gray-800">Nguyễn Viết Hiệp</p><p class="text-sm text-gray-500">MSV: 2351281938</p></div></div></div></div>`;
    }

    function renderBaitapView() {
        mainContentArea.innerHTML = `
            <div class="w-full max-w-5xl mx-auto p-4">
                <h2 class="text-3xl font-bold text-gray-800 mb-8 text-center">Bài tập Phục hồi Chức năng</h2>

                <div class="grid grid-cols-1 md:grid-cols-3 gap-8">

                    <a href="https://www.youtube.com/watch?v=YtvpZXA-WbY" target="_blank" class="block bg-white p-6 rounded-xl shadow-lg text-center transform hover:-translate-y-2 transition-transform duration-300 no-underline">
                        <div class="text-6xl mb-4">😙</div>
                        <h3 class="text-xl font-bold text-teal-700 mb-2">
                            <span contenteditable="true" class="focus:outline-none focus:ring-2 focus:ring-teal-500 rounded-md px-1">
                                Tập cơ mặt
                            </span>
                        </h3>
                        <p class="text-gray-600">
                        <span contenteditable="true" class="focus:outline-none focus:ring-2 focus:ring-gray-400 rounded-md px-1">
                                Giảm chảy nước dãi, nhai nuốt khỏe, nói dễ.
                        </span>
                        </p>
                    </a>

                    <a href="https://www.youtube.com/watch?v=uvdncjviy3s" target="_blank" class="block bg-white p-6 rounded-xl shadow-lg text-center transform hover:-translate-y-2 transition-transform duration-300 no-underline">
                        <div class="text-6xl mb-4">💪</div>
                        <h3 class="text-xl font-bold text-sky-700 mb-2">
                            <span contenteditable="true" class="focus:outline-none focus:ring-2 focus:ring-sky-500 rounded-md px-1">
                                Bài tập vận động
                            </span>
                        </h3>
                        <p class="text-gray-600">
                        <span contenteditable="true" class="focus:outline-none focus:ring-2 focus:ring-gray-400 rounded-md px-1">
                                Cải thiện khả năng vận động và linh hoạt.
                        </span>
                        </p>
                    </a>

                    <a href="https://www.youtube.com/watch?v=xL4tIP2fj1g" target="_blank" class="block bg-white p-6 rounded-xl shadow-lg text-center transform hover:-translate-y-2 transition-transform duration-300 no-underline">
                        <div class="text-6xl mb-4">👄</div>
                        <h3 class="text-xl font-bold text-amber-700 mb-2">
                        <span contenteditable="true" class="focus:outline-none focus:ring-2 focus:ring-amber-500 rounded-md px-1">
                                Bài tập nói
                        </span>
                        </h3>
                        <p class="text-gray-600">
                        <span contenteditable="true" class="focus:outline-none focus:ring-2 focus:ring-gray-400 rounded-md px-1">
                                Cải thiện khả năng giao tiếp, chức năng nuốt.
                        </span>
                        </p>
                    </a>

                </div>
            </div>
        `;
    }
    async function createHandLandmarkerModel() {
        try {
            const vision = await FilesetResolver.forVisionTasks("https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm");
            handLandmarker = await HandLandmarker.createFromOptions(vision, {
                baseOptions: { modelAssetPath: `/static/models/hand_landmarker.task`, delegate: "GPU" },
                runningMode: "VIDEO", numHands: 1
            });
            isModelReady = true;
            if (currentView === 'diagnosis') {
                document.getElementById('status-message').innerText = "Mô hình đã sẵn sàng.";
            }
        } catch (error) {
            console.error("Lỗi khi tạo mô hình HandLandmarker:", error);
            showModal("Lỗi mô hình", "Không thể tải mô hình nhận dạng. Vui lòng kiểm tra kết nối mạng và thử lại.");
        }
    }

    function startDiagnosis(sourceType, file = null) {
        if (!isModelReady) {
            showModal("Lỗi", "Mô hình nhận dạng chưa sẵn sàng. Vui lòng đợi.");
            return;
        }
        if (!appState.quizResult) {
            showModal("Thiếu thông tin", "Vui lòng hoàn thành 'Bộ câu hỏi' trước khi chẩn đoán run để có thể lưu kết quả đầy đủ.");
            switchView('quiz');
            return;
        }
        
        allFingerMovementData = {}; 
        const controls = document.getElementById('diagnosis-controls');
        controls.querySelector('#stop-btn').classList.remove('hidden');
        controls.querySelector('#start-camera-btn').classList.add('hidden');
        controls.querySelector('label[for="video-upload"]').classList.add('hidden');
        initializeTremorCharts();

        if (sourceType === 'camera') {
            document.getElementById('status-message').innerText = "Đang khởi động camera...";
            navigator.mediaDevices.getUserMedia({ video: true }).then((stream) => {
                video.srcObject = stream;
                video.addEventListener("loadeddata", predictWebcam);
            }).catch(err => {
                 showModal("Lỗi Camera", `Không thể truy cập camera: ${err.message}`);
                 stopAllActivities();
            });
        } else if (sourceType === 'video' && file) {
            video.src = URL.createObjectURL(file);
            video.onended = () => {
                stopWebcamLoop();
                document.getElementById('status-message').innerText = 'Phân tích hoàn tất! Đang gửi dữ liệu...';
                analyzeTremorData();
            };
            video.addEventListener('loadeddata', () => {
                video.play();
                predictWebcam();
            });
        }
    }

    async function predictWebcam() {
        if (currentView !== 'diagnosis' || !video || (!video.srcObject && !video.currentSrc)) return;
        if (video.readyState < 2) {
            if (!video.ended) window.requestAnimationFrame(predictWebcam);
            return;
        }

        if (lastVideoTime !== video.currentTime) {
            lastVideoTime = video.currentTime;
            const now = Date.now();
            
            const handResults = handLandmarker.detectForVideo(video, now);
            
            canvasElement.width = video.videoWidth;
            canvasElement.height = video.videoHeight;
            canvasCtx.save();
            canvasCtx.clearRect(0, 0, canvasElement.width, canvasElement.height);
            
            if (handResults.landmarks && handResults.landmarks.length > 0) {
                for (const landmarks of handResults.landmarks) {
                    // Vẽ các đường nối theo màu đã định nghĩa
                    drawingUtils.drawConnectors(landmarks, PALM_CONNECTIONS, { color: FINGER_COLORS.palm, lineWidth: 5 });
                    drawingUtils.drawConnectors(landmarks, THUMB_CONNECTIONS, { color: FINGER_COLORS.thumb, lineWidth: 5 });
                    drawingUtils.drawConnectors(landmarks, INDEX_CONNECTIONS, { color: FINGER_COLORS.index, lineWidth: 5 });
                    drawingUtils.drawConnectors(landmarks, MIDDLE_CONNECTIONS, { color: FINGER_COLORS.middle, lineWidth: 5 });
                    drawingUtils.drawConnectors(landmarks, RING_CONNECTIONS, { color: FINGER_COLORS.ring, lineWidth: 5 });
                    drawingUtils.drawConnectors(landmarks, PINKY_CONNECTIONS, { color: FINGER_COLORS.pinky, lineWidth: 5 });

                    // Vẽ các điểm mốc (landmarks) với màu tương ứng theo hình ảnh mới
                    drawingUtils.drawLandmarks(landmarks, {
                        color: (landmark, index) => {
                            const baseKnuckleIndices = [0, 1, 5, 9, 13, 17];
                            if (baseKnuckleIndices.includes(index)) {
                                return FINGER_COLORS.base; // Màu đỏ cho khớp gốc
                            }
                            if (index >= 2 && index <= 4) return FINGER_COLORS.thumb;
                            if (index >= 6 && index <= 8) return FINGER_COLORS.index;
                            if (index >= 10 && index <= 12) return FINGER_COLORS.middle;
                            if (index >= 14 && index <= 16) return FINGER_COLORS.ring;
                            if (index >= 18 && index <= 20) return FINGER_COLORS.pinky;
                            return FINGER_COLORS.palm;
                        },
                        radius: 7, // Tăng kích thước các điểm cho dễ nhìn
                        lineWidth: 2
                    });

                    // Thu thập dữ liệu run tay (giữ nguyên)
                    for (const fingerName in FINGER_DEFINITIONS) {
                        const tipLandmark = landmarks[FINGER_DEFINITIONS[fingerName]];
                        if (tipLandmark) {
                            if (!allFingerMovementData[fingerName]) allFingerMovementData[fingerName] = [];
                            allFingerMovementData[fingerName].push({ t: video.currentTime, x: tipLandmark.x, y: tipLandmark.y });
                        }
                    }
                }
            }
            canvasCtx.restore();
        }
        
        // Phần còn lại của hàm để xử lý thời gian và gọi đệ quy
        if (video.srcObject) { 
            if (analysisStartTime === null) analysisStartTime = performance.now();
            const elapsedTime = performance.now() - analysisStartTime;
            const remainingTime = Math.max(0, (ANALYSIS_DURATION_MS - elapsedTime) / 1000).toFixed(1);
            document.getElementById('status-message').innerHTML = `Đang phân tích... Vui lòng giữ yên tay.<br>Thời gian còn lại: ${remainingTime}s`;

            if (elapsedTime >= ANALYSIS_DURATION_MS) {
                stopWebcamLoop();
                document.getElementById('status-message').innerText = 'Phân tích hoàn tất! Đang gửi dữ liệu...';
                analyzeTremorData();
                return;
            }
        }
        
        if (!video.ended) {
            animationFrameId = window.requestAnimationFrame(predictWebcam);
        }
    }

    async function analyzeTremorData() {
        let bestFingerName = null, maxTremorMagnitude = -1;
        for (const fingerName in allFingerMovementData) {
            const data = allFingerMovementData[fingerName];
            if (data.length < 20) continue;
            const xData = data.map(p => p.x);
            const yData = data.map(p => p.y);
            const stdDevX = Math.sqrt(xData.map(x => (x - xData.reduce((a, b) => a + b) / xData.length) ** 2).reduce((a, b) => a + b) / xData.length);
            const stdDevY = Math.sqrt(yData.map(y => (y - yData.reduce((a, b) => a + b) / yData.length) ** 2).reduce((a, b) => a + b) / yData.length);
            const magnitude = Math.sqrt(stdDevX ** 2 + stdDevY ** 2);
            if (magnitude > maxTremorMagnitude) {
                maxTremorMagnitude = magnitude;
                bestFingerName = fingerName;
            }
        }
        if (!bestFingerName) {
            showModal("Lỗi", "Không có đủ dữ liệu ổn định để phân tích. Vui lòng thử lại.");
            stopAllActivities();
            return;
        }

        const bestFingerData = allFingerMovementData[bestFingerName];
        const xData = bestFingerData.map(p => p.x);
        const yData = bestFingerData.map(p => p.y);
        const stdDevX = Math.sqrt(xData.map(x => (x - xData.reduce((a, b) => a + b) / xData.length) ** 2).reduce((a, b) => a + b) / xData.length);
        const stdDevY = Math.sqrt(yData.map(y => (y - yData.reduce((a, b) => a + b) / yData.length) ** 2).reduce((a, b) => a + b) / yData.length);
        
        let finalSignal, chosenAxis;
        if (stdDevX >= stdDevY) {
            finalSignal = xData;
            chosenAxis = 'X';
        } else {
            finalSignal = yData;
            chosenAxis = 'Y';
        }

        showModal("Đang xử lý", "Đang gửi dữ liệu đến máy chủ...", true);
        const duration = bestFingerData[bestFingerData.length - 1].t - bestFingerData[0].t;
        try {
            const response = await fetch('/api/analyze_tremor', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ tremor_data: { time_series: finalSignal, duration: duration }, quiz_data: appState.quizResult })
            });
            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.message || 'Lỗi không xác định từ máy chủ.');
            }
            const result = await response.json();
            hideModal();
            
            const { peak_frequency, conclusion, time_domain_data, frequency_domain_data } = result;
            appState.diagnosisResult = { peakFrequency: peak_frequency };

            document.getElementById('tremor-chart-title').innerText = `Phân tích ${bestFingerName} - Trục ${chosenAxis}`;
            tremorChart.data.labels = time_domain_data.time_axis.map(t => t.toFixed(2));
            tremorChart.data.datasets[0].data = time_domain_data.signal;
            tremorChart.options.plugins.title.text = `Tần số đỉnh: ${peak_frequency.toFixed(2)} Hz`;
            tremorChart.update();

            fftChart.data.labels = frequency_domain_data.frequencies.map(f => f.toFixed(2));
            fftChart.data.datasets[0].data = frequency_domain_data.amplitudes;
            const peakIndex = frequency_domain_data.frequencies.findIndex(f => Math.abs(f - peak_frequency) < 0.1);
            const backgroundColors = Array(frequency_domain_data.amplitudes.length).fill('rgba(255, 99, 132, 0.5)');
            if (peakIndex !== -1) backgroundColors[peakIndex] = 'rgba(255, 99, 132, 1)';
            fftChart.data.datasets[0].backgroundColor = backgroundColors;
            fftChart.update();
            
            const resultText = document.getElementById('result-text');
            resultText.innerHTML = conclusion.text;
            resultText.style.color = conclusion.color;
            document.getElementById('final-actions-container').classList.remove('hidden');
        } catch (error) {
            hideModal();
            showModal("Phân tích Thất bại", error.message);
        }
    }

    function stopWebcamLoop() {
        if (animationFrameId) {
            window.cancelAnimationFrame(animationFrameId);
            animationFrameId = null;
        }
        if (video && video.srcObject) {
            video.srcObject.getTracks().forEach(track => track.stop());
            video.srcObject = null;
        }
        lastVideoTime = -1;
        analysisStartTime = null;
    }

    function stopAllActivities() {
        stopWebcamLoop();
        if (gammaChart) { gammaChart.destroy(); gammaChart = null; }
        if (tremorChart) { tremorChart.destroy(); tremorChart = null; }
        if (fftChart) { fftChart.destroy(); fftChart = null; }
        if (map) { map.remove(); map = null; }
    }

    function initializeTremorCharts() {
        if (tremorChart) tremorChart.destroy();
        if (fftChart) fftChart.destroy();
        const commonPlugins = { zoom: { pan: { enabled: true, mode: 'x' }, zoom: { wheel: { enabled: true }, pinch: { enabled: true }, mode: 'x' } } };
        const tremorCtx = document.getElementById('tremor-chart')?.getContext('2d');
        if (tremorCtx) {
            tremorChart = new Chart(tremorCtx, { type: 'line', data: { labels: [], datasets: [{ label: 'Dao động đã lọc', data: [], borderColor: 'rgb(75, 192, 192)', tension: 0.1, pointRadius: 0 }] }, options: { plugins: {...commonPlugins, title: { display: true, text: '' }}, scales: { x: { title: { text: 'Thời gian (s)', display: true }}, y: { title: { text: 'Biên độ (pixels)', display: true } } } } });
        }
        const fftCtx = document.getElementById('fft-chart')?.getContext('2d');
        if (fftCtx) {
            fftChart = new Chart(fftCtx, { type: 'bar', data: { labels: [], datasets: [{ label: 'Biên độ', data: [], backgroundColor: 'rgba(255, 99, 132, 0.5)' }] }, options: { plugins: commonPlugins, scales: { x: { title: { text: 'Tần số (Hz)', display: true } }, y: { title: { text: 'Biên độ', display: true }, beginAtZero: true } } } });
        }
        const finalActionsContainer = document.getElementById('final-actions-container');
        if (finalActionsContainer) {
            finalActionsContainer.querySelector('#reset-zoom-btn').onclick = () => { tremorChart?.resetZoom(); fftChart?.resetZoom(); };
            finalActionsContainer.querySelector('#download-results-btn').onclick = downloadResults;
        }
    }

    function downloadResults() {
        if (!tremorChart || !fftChart) return;
        const canvas1 = tremorChart.canvas, canvas2 = fftChart.canvas;
        const combinedCanvas = document.createElement('canvas');
        const ctx = combinedCanvas.getContext('2d');
        const padding = 50, titleHeight = 50;
        combinedCanvas.width = canvas1.width + canvas2.width + padding * 3;
        combinedCanvas.height = Math.max(canvas1.height, canvas2.height) + titleHeight + padding;
        ctx.fillStyle = 'white';
        ctx.fillRect(0, 0, combinedCanvas.width, combinedCanvas.height);
        ctx.fillStyle = 'black';
        ctx.font = 'bold 20px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(document.getElementById('tremor-chart-title').innerText, padding + canvas1.width / 2, titleHeight - 10);
        ctx.drawImage(canvas1, padding, titleHeight);
        ctx.fillText('Phân tích tần số (FFT)', padding * 2 + canvas1.width + canvas2.width / 2, titleHeight - 10);
        ctx.drawImage(canvas2, padding * 2 + canvas1.width, titleHeight);
        const imageLink = document.createElement('a');
        imageLink.href = combinedCanvas.toDataURL('image/png', 1.0);
        imageLink.download = 'ket-qua-chan-doan.png';
        imageLink.click();
    }

    function startGammaSimulation() {
        const ctx = document.getElementById('gamma-chart')?.getContext('2d');
        if (!ctx) return;
        const eegBands = ['DELTA', 'THETA', 'ALPHA', 'BETA', 'GAMMA'];
        const chartData = { labels: eegBands, datasets: [{ label: 'Power (uV)^2 / Hz', data: [10, 5, 8, 12, 20], backgroundColor: ['#1f77b4', '#ff7f00', '#2ca02c', '#d62728', '#9467bd'] }] };
        gammaChart = new Chart(ctx, { type: 'bar', data: chartData, options: { responsive: true, plugins: { legend: { display: false }, title: { display: true, text: 'Năng lượng các dải tần EEG (Mô phỏng)' } } } });
        animationFrameId = setInterval(() => {
            if (gammaChart) {
                gammaChart.data.datasets[0].data = gammaChart.data.datasets[0].data.map(val => Math.max(1, val + (Math.random() - 0.5) * 4));
                gammaChart.update();
            } else { clearInterval(animationFrameId); }
        }, 500);
    }

    function initMap() {
        const mapContainer = document.getElementById('map');
        if (!mapContainer || mapContainer._leaflet_id) return;
        const defaultLocation = [21.0285, 105.8542]; // Hanoi
        map = L.map(mapContainer).setView(defaultLocation, 13);
        document.getElementById('map-placeholder').style.display = 'none';
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '&copy; OpenStreetMap' }).addTo(map);
        const findHospitals = async (coords) => {
            const [lat, lon] = coords;
            const url = `https://overpass-api.de/api/interpreter?data=[out:json];(node["amenity"="hospital"](around:10000,${lat},${lon});way["amenity"="hospital"](around:10000,${lat},${lon}););out center;`;
            try {
                const response = await fetch(url);
                const data = await response.json();
                data.elements.forEach(el => {
                    const pos = el.type === 'node' ? [el.lat, el.lon] : [el.center.lat, el.center.lon];
                    L.marker(pos).addTo(map).bindPopup(`<b>${el.tags?.name || 'Bệnh viện'}</b>`);
                });
            } catch (e) { console.error("Lỗi tải bệnh viện:", e); }
        };
        if (navigator.geolocation) {
            navigator.geolocation.getCurrentPosition(
                (pos) => {
                    const userLocation = [pos.coords.latitude, pos.coords.longitude];
                    map.setView(userLocation, 13);
                    L.marker(userLocation).addTo(map).bindPopup('<b>Vị trí của bạn</b>').openPopup();
                    findHospitals(userLocation);
                }, () => findHospitals(defaultLocation));
        } else {
            findHospitals(defaultLocation);
        }
    }

    navButtons.forEach(button => {
        button.addEventListener('click', () => switchView(button.dataset.view));
    });

    switchView('welcome');
    createHandLandmarkerModel();
});