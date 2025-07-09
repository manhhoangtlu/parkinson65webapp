import {
    HandLandmarker,
    FilesetResolver,
    DrawingUtils
} from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/vision_bundle.js";

// Sự kiện này đảm bảo code chỉ chạy sau khi toàn bộ trang web đã được tải
document.addEventListener('DOMContentLoaded', () => {

    // --- BIẾN TOÀN CỤC VÀ TRẠNG THÁI ỨNG DỤNG ---
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

    // --- DỮ LIỆU CỐ ĐỊNH ---
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

    // --- LOGIC HỘP THOẠI (MODAL) ---
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

    // --- LOGIC TRỢ LÝ AI ---
    async function callAIAssistant(prompt) {
        try {
            const response = await fetch('/api/ai_summary', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ prompt: prompt })
            });
            if (!response.ok) throw new Error('Lỗi khi gọi AI');
            const result = await response.json();
            return result.text;
        } catch (error) {
            console.error("AI call failed:", error);
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

    // --- QUẢN LÝ HIỂN THỊ (VIEWS) ---
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
            'doctor': renderDoctorView
        };
        (renderMap[viewName] || renderWelcomeView)();
    }

    function renderWelcomeView() {
        mainContentArea.innerHTML = `<div class="text-center"><h2 class="text-4xl font-bold text-gray-800 mb-4">Chào mừng!</h2><p class="text-lg text-gray-600">Chọn một chức năng bên dưới để bắt đầu.</p></div>`;
    }

    function renderQuizView() {
        let currentQuestionIndex = 0;
        let userAnswers = {};

        function displayQuestion() {
            const question = quizQuestions[currentQuestionIndex];
            mainContentArea.innerHTML = `
                <div class="w-full max-w-2xl bg-white p-8 rounded-xl shadow-lg">
                    <p class="text-gray-500">Câu hỏi ${currentQuestionIndex + 1} / ${quizQuestions.length}</p>
                    <div class="w-full bg-gray-200 rounded-full h-2.5 mt-1"><div class="bg-blue-600 h-2.5 rounded-full" style="width: ${((currentQuestionIndex + 1) / quizQuestions.length) * 100}%"></div></div>
                    <h3 class="text-2xl font-semibold my-6 text-gray-800">${question.text}</h3>
                    <div class="space-y-4">${question.options.map((opt, index) => `<div><input type="radio" id="option${index}" name="quizOption" value="${index}" class="hidden peer"><label for="option${index}" class="block cursor-pointer select-none rounded-xl p-4 text-center text-gray-700 border-2 border-gray-300 peer-checked:bg-blue-500 peer-checked:font-bold peer-checked:text-white">${opt}</label></div>`).join('')}</div>
                    <button id="next-question-btn" class="mt-8 w-full bg-blue-600 text-white py-3 rounded-lg font-semibold hover:bg-blue-700">Tiếp theo</button>
                </div>`;
            document.getElementById('next-question-btn').addEventListener('click', nextQuestion);
        }

        function nextQuestion() {
            const selectedOption = document.querySelector('input[name="quizOption"]:checked');
            if (!selectedOption) {
                showModal("Thông báo", "Vui lòng chọn một đáp án.");
                return;
            }
            const questionKey = quizQuestions[currentQuestionIndex].key;
            const answerText = quizQuestions[currentQuestionIndex].options[selectedOption.value];
            userAnswers[questionKey] = answerText;

            currentQuestionIndex++;
            if (currentQuestionIndex < quizQuestions.length) displayQuestion();
            else showQuizResults(userAnswers);
        }
        displayQuestion();
    }

    async function showQuizResults(userAnswers) {
        showModal("Đang xử lý", "Đang gửi kết quả lên máy chủ...", true);
        try {
            const response = await fetch('/api/submit_quiz', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ answers: userAnswers })
            });
            if (!response.ok) throw new Error('Lỗi khi gửi kết quả quiz.');
            const result = await response.json();
            const score = result.score;

            appState.quizResult = { score, answers: userAnswers }; 
            hideModal();

            const totalPossibleScore = quizQuestions.length * 2;
            let resultMessage = `Tổng điểm của cô/chú là: <strong>${score} / ${totalPossibleScore}</strong><br><br>${score > 6 ? "Dựa trên câu trả lời, có một số dấu hiệu của bệnh Parkinson. Vui lòng tham khảo ý kiến bác sĩ." : "Không nhận thấy các dấu hiệu rõ ràng. Tuy nhiên, nếu có bất kỳ lo lắng nào, hãy tham khảo ý kiến bác sĩ."}`;
            
            mainContentArea.innerHTML = `
                <div class="text-center w-full max-w-2xl bg-white p-8 rounded-xl shadow-lg">
                    <h2 class="text-3xl font-bold text-gray-800 mb-4">Hoàn thành!</h2>
                    <p class="text-lg text-gray-600">${resultMessage}</p>
                    <div class="mt-8 space-x-4">
                        <button id="restart-quiz-btn" class="bg-blue-600 text-white py-3 px-6 rounded-lg font-semibold hover:bg-blue-700">Làm lại</button>
                        <button id="ai-analysis-btn" class="bg-gradient-to-r from-purple-500 to-indigo-600 text-white py-3 px-6 rounded-lg font-semibold hover:opacity-90">✨ Nhận phân tích từ AI</button>
                    </div>
                </div>`;
            document.getElementById('restart-quiz-btn').addEventListener('click', () => switchView('quiz'));
            document.getElementById('ai-analysis-btn').addEventListener('click', handleAiQuizAnalysis);
        } catch (error) {
            hideModal();
            showModal("Lỗi", "Không thể lấy điểm từ máy chủ.");
        }
    }

    function renderDiagnosisView() {
        mainContentArea.innerHTML = `
            <div class="w-full max-w-4xl bg-white p-8 rounded-xl shadow-lg text-center">
                <h2 class="text-3xl font-bold text-gray-800 mb-4">Chẩn đoán run tay</h2>
                <p class="text-gray-600 mb-6">Sử dụng camera hoặc tải video lên để phân tích. Để có kết quả đầy đủ nhất, vui lòng hoàn thành 'Bộ câu hỏi' trước.</p>
                <div id="diagnosis-controls" class="flex flex-wrap justify-center items-center gap-4">
                    <button id="start-camera-btn" class="bg-blue-600 text-white py-2 px-5 rounded-lg font-semibold hover:bg-blue-700">Phân tích từ Camera</button>
                    <label for="video-upload" class="bg-purple-600 text-white py-2 px-5 rounded-lg font-semibold hover:bg-purple-700 cursor-pointer">Chọn file Video</label>
                    <input type="file" id="video-upload" class="hidden" accept="video/*">
                    <button id="stop-btn" class="bg-red-600 text-white py-2 px-5 rounded-lg font-semibold hover:bg-red-700 hidden">Dừng</button>
                </div>
                <div id="status-message" class="text-blue-600 font-semibold my-4 h-12 flex items-center justify-center"></div>
                <div class="relative w-full max-w-2xl mx-auto aspect-video bg-gray-900 rounded-lg overflow-hidden">
                    <video id="webcam" class="absolute inset-0 w-full h-full" autoplay playsinline></video>
                    <canvas id="output_canvas" class="absolute inset-0 w-full h-full"></canvas>
                </div>
                <div id="charts-container" class="mt-8 grid md:grid-cols-2 gap-6">
                    <div><h3 id="tremor-chart-title" class="font-semibold text-lg mb-2">Biên độ run theo thời gian</h3><canvas id="tremor-chart"></canvas></div>
                    <div><h3 class="font-semibold text-lg mb-2">Phân tích tần số (FFT)</h3><canvas id="fft-chart"></canvas></div>
                </div>
                <div id="final-actions-container" class="mt-6 flex justify-center items-center gap-4 hidden">
                     <button id="reset-zoom-btn" class="bg-gray-500 text-white py-2 px-5 rounded-lg font-semibold hover:bg-gray-600">Reset Zoom</button>
                     <button id="download-results-btn" class="bg-sky-500 text-white py-2 px-5 rounded-lg font-semibold hover:bg-sky-600">Tải xuống Biểu đồ</button>
                </div>
                <div id="result-text" class="mt-6 text-2xl font-bold"></div>
            </div>`;
        
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
        mainContentArea.innerHTML = `
            <div class="w-full max-w-4xl bg-white p-8 rounded-xl shadow-lg text-center">
                <h2 class="text-3xl font-bold text-gray-800 mb-4">Mô phỏng Phân tích Sóng não</h2>
                <p class="text-gray-600 mb-6">Đây là màn hình mô phỏng dữ liệu sóng não EEG. Biểu đồ dưới đây tự động tạo ra dữ liệu để minh họa.</p>
                <div class="w-full"><canvas id="gamma-chart"></canvas></div>
            </div>`;
        startGammaSimulation();
    }

    function renderDoctorView() {
        mainContentArea.innerHTML = `
            <div class="w-full max-w-6xl bg-white p-8 rounded-xl shadow-lg grid md:grid-cols-2 gap-8">
                <div class="text-center md:text-left">
                    <h2 class="text-3xl font-bold text-gray-800 mb-4">Liên hệ Bác sĩ</h2>
                    <p class="text-lg text-gray-700 mb-2">Để được tư vấn và chẩn đoán chính xác, vui lòng liên hệ các cơ sở y tế gần bạn.</p>
                    <div class="mt-4 space-y-3">
                        <div class="bg-gray-100 p-4 rounded-lg">
                            <p class="text-xl font-semibold text-blue-700">Bệnh Viện Bạch Mai</p>
                            <p class="text-md text-gray-600 mt-1"><strong>SĐT:</strong> 024 3869 3731</p>
                            <p class="text-md text-gray-600"><strong>Địa chỉ:</strong> 78 Đường Giải Phóng, Đống Đa, Hà Nội</p>
                        </div>
                    </div>
                    <div id="ai-assistant-container" class="mt-6 bg-indigo-50 p-4 rounded-lg">
                       <h3 class="text-xl font-bold text-indigo-800 mb-2">✨ Trợ lý AI: Chuẩn bị cho buổi hẹn</h3>
                       <p class="text-gray-700 mb-4">Hoàn thành "Bộ câu hỏi" và "Chẩn đoán Run" để AI có thể đưa ra gợi ý hữu ích nhất.</p>
                       <button id="ai-doctor-prep-btn" class="bg-indigo-600 text-white py-2 px-5 rounded-lg font-semibold hover:bg-indigo-700 disabled:bg-gray-400">Tạo gợi ý thảo luận</button>
                       <div id="ai-assistant-content" class="mt-4 text-gray-800"></div>
                    </div>
                </div>
                <div id="map-container" class="w-full h-80 md:h-full rounded-lg overflow-hidden shadow-inner border bg-gray-200 flex items-center justify-center">
                    <p id="map-placeholder" class="text-gray-500">Đang tải bản đồ...</p>
                    <div id="map" class="w-full h-full"></div>
                </div>
            </div>`;
        initMap();
        
        const prepButton = document.getElementById('ai-doctor-prep-btn');
        prepButton.disabled = !(appState.quizResult && appState.diagnosisResult);
        prepButton.addEventListener('click', handleAiDoctorPrep);
    }

    // --- LOGIC MEDIAPIPE & CHẨN ĐOÁN ---
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
            const url = URL.createObjectURL(file);
            video.src = url;
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
                    drawingUtils.drawConnectors(landmarks, HandLandmarker.HAND_CONNECTIONS, { color: "#007BFF", lineWidth: 3 });
                    drawingUtils.drawLandmarks(landmarks, { color: "#FFFFFF", radius: 3, lineWidth: 1 });
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
            showModal("Lỗi", "Không có đủ dữ liệu ổn định để phân tích.");
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
        const payload = {
            tremor_data: { time_series: finalSignal, duration: duration },
            quiz_data: appState.quizResult
        };

        try {
            const response = await fetch('/api/analyze_tremor', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            
            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.message || 'Lỗi không xác định từ máy chủ.');
            }
            
            const result = await response.json();
            hideModal();
            
            const { peak_frequency, conclusion, time_domain_data, frequency_domain_data } = result;
            appState.diagnosisResult = { peakFrequency: peak_frequency };

            const tremorTitle = document.getElementById('tremor-chart-title');
            tremorTitle.innerText = `Phân tích ${bestFingerName} - Trục ${chosenAxis}`;
            tremorChart.data.labels = time_domain_data.time_axis.map(t => t.toFixed(2));
            tremorChart.data.datasets[0].data = time_domain_data.signal;
            tremorChart.options.plugins.title.text = `Tần số đỉnh: ${peak_frequency.toFixed(2)} Hz`;
            tremorChart.update();

            fftChart.data.labels = frequency_domain_data.frequencies.map(f => f.toFixed(2));
            fftChart.data.datasets[0].data = frequency_domain_data.amplitudes;
            
            const peakIndex = frequency_domain_data.frequencies.findIndex(f => Math.abs(f - peak_frequency) < 0.1);
            const backgroundColors = Array(frequency_domain_data.amplitudes.length).fill('rgba(255, 99, 132, 0.5)');
            if (peakIndex !== -1) {
                backgroundColors[peakIndex] = 'rgba(255, 99, 132, 1)';
            }
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

    // --- CÁC HÀM TIỆN ÍCH KHÁC ---
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

        const commonPlugins = {
            zoom: {
                pan: { enabled: true, mode: 'x' },
                zoom: { wheel: { enabled: true }, pinch: { enabled: true }, mode: 'x' }
            }
        };
        
        const tremorCtx = document.getElementById('tremor-chart')?.getContext('2d');
        if (tremorCtx) {
            tremorChart = new Chart(tremorCtx, {
                type: 'line',
                data: { labels: [], datasets: [{ label: 'Dao động đã lọc', data: [], borderColor: 'rgb(75, 192, 192)', tension: 0.1, pointRadius: 0 }] },
                options: { plugins: {...commonPlugins, title: { display: true, text: '' }}, scales: { x: { title: { text: 'Thời gian (s)', display: true }}, y: { title: { text: 'Biên độ (pixels)', display: true } } } }
            });
        }

        const fftCtx = document.getElementById('fft-chart')?.getContext('2d');
        if (fftCtx) {
            fftChart = new Chart(fftCtx, {
                type: 'bar',
                data: { labels: [], datasets: [{ label: 'Biên độ', data: [], backgroundColor: 'rgba(255, 99, 132, 0.5)' }] },
                options: { plugins: commonPlugins, scales: { x: { title: { text: 'Tần số (Hz)', display: true } }, y: { title: { text: 'Biên độ', display: true }, beginAtZero: true } } }
            });
        }

        const finalActionsContainer = document.getElementById('final-actions-container');
        if (finalActionsContainer) {
            finalActionsContainer.querySelector('#reset-zoom-btn').onclick = () => {
                tremorChart?.resetZoom();
                fftChart?.resetZoom();
            };
            finalActionsContainer.querySelector('#download-results-btn').onclick = downloadResults;
        }
    }

    function downloadResults() {
        if (!tremorChart || !fftChart) return;
        const canvas1 = tremorChart.canvas;
        const canvas2 = fftChart.canvas;

        const combinedCanvas = document.createElement('canvas');
        const ctx = combinedCanvas.getContext('2d');
        const padding = 50;
        const titleHeight = 50;

        combinedCanvas.width = canvas1.width + canvas2.width + padding * 3;
        combinedCanvas.height = Math.max(canvas1.height, canvas2.height) + titleHeight + padding;
        
        ctx.fillStyle = 'white';
        ctx.fillRect(0, 0, combinedCanvas.width, combinedCanvas.height);
        
        ctx.fillStyle = 'black';
        ctx.font = 'bold 20px Inter';
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
                },
                () => findHospitals(defaultLocation)
            );
        } else {
            findHospitals(defaultLocation);
        }
    }

    // --- KHỞI CHẠY ỨNG DỤNG ---
    navButtons.forEach(button => {
        button.addEventListener('click', () => {
            switchView(button.dataset.view)
        });
    });

    switchView('welcome');
    createHandLandmarkerModel();

});