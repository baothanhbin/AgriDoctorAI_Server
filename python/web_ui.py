from flask import Flask, request, jsonify, render_template_string
import os
import sys
import uuid
from werkzeug.utils import secure_filename
import base64

# Thêm folder python vào path để import script inference của bạn
CURRENT_DIR = os.path.dirname(os.path.abspath(__file__))
if CURRENT_DIR not in sys.path:
    sys.path.append(CURRENT_DIR)
from inference import run_inference

app = Flask(__name__)
UPLOAD_FOLDER = 'runs/web_uploads'
os.makedirs(UPLOAD_FOLDER, exist_ok=True)

HTML_TEMPLATE = """
<!DOCTYPE html>
<html lang="vi">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>AI Plant Doctor - Local UI Test</title>
    <style>
        body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background: #f4f7f6; margin: 0; padding: 20px; color: #333; }
        .container { max-width: 1000px; margin: 0 auto; background: white; padding: 30px; border-radius: 12px; box-shadow: 0 4px 15px rgba(0,0,0,0.05); }
        h1 { text-align: center; color: #2c3e50; margin-bottom: 30px; }
        .upload-area { border: 2px dashed #3498db; padding: 40px; text-align: center; border-radius: 8px; cursor: pointer; transition: 0.3s; background: #f8fbff; }
        .upload-area:hover { background: #eef5ff; border-color: #2980b9; }
        #fileInput { display: none; }
        .btn { background: #3498db; color: white; border: none; padding: 12px 25px; border-radius: 6px; font-size: 16px; cursor: pointer; margin-top: 15px; font-weight: bold; transition: 0.3s; }
        .btn:hover { background: #2980b9; }
        .btn:disabled { background: #95a5a6; cursor: not-allowed; }
        
        .result-container { display: flex; gap: 30px; margin-top: 30px; }
        .image-col, .info-col { flex: 1; }
        
        .canvas-container { position: relative; width: 100%; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
        canvas { width: 100%; display: block; }
        
        .info-card { background: #f8f9fa; padding: 20px; border-radius: 8px; border-left: 5px solid #2ecc71; margin-bottom: 15px; }
        .info-card.error { border-left-color: #e74c3c; }
        
        .badge { display: inline-block; padding: 5px 10px; border-radius: 20px; background: #2ecc71; color: white; font-size: 14px; font-weight: bold; }
        
        .log-box { background: #2c3e50; color: #ecf0f1; padding: 15px; border-radius: 8px; font-family: monospace; font-size: 13px; max-height: 200px; overflow-y: auto; }
        .detection-item { padding: 10px; border-bottom: 1px solid #ddd; display: flex; justify-content: space-between; }
        .detection-item:last-child { border-bottom: none; }
        
        #loader { display: none; text-align: center; margin: 20px 0; font-weight: bold; color: #3498db; }
    </style>
</head>
<body>

<div class="container">
    <h1>🌱 AI Plant Doctor - Local Web Test</h1>
    
    <div class="upload-area" id="dropZone" onclick="document.getElementById('fileInput').click()">
        <h3 style="margin:0 0 10px 0;">Kéo thả ảnh hoặc Click để chọn ảnh</h3>
        <p style="color: #7f8c8d; margin:0;">Chỉ hỗ trợ JPG, PNG</p>
        <input type="file" id="fileInput" accept="image/png, image/jpeg, image/jpg" onchange="handleFileSelect(event)">
    </div>

    <div style="text-align: center;">
        <button class="btn" id="predictBtn" onclick="runPrediction()" disabled>🚀 Phân Tích Ảnh</button>
    </div>
    
    <div id="loader">⏳ Đang xử lý qua mô hình AI (Classification & Detection)...</div>

    <div class="result-container" id="resultArea" style="display: none;">
        <div class="image-col">
            <h3>🖼️ Ảnh Kết Quả</h3>
            <div class="canvas-container">
                <canvas id="imageCanvas"></canvas>
            </div>
        </div>
        <div class="info-col">
            <h3>📊 Kết Quả Chẩn Đoán</h3>
            <div id="classificationResult" class="info-card"></div>
            
            <h3>🦠 Phát Hiện Bệnh (Detection)</h3>
            <div id="detectionResult" class="info-card" style="border-left-color: #e67e22;"></div>
            
            <h3>🛠️ Debug Logs</h3>
            <div id="debugLogs" class="log-box"></div>
        </div>
    </div>
</div>

<script>
    let selectedFile = null;
    let imgObj = null;

    const dropZone = document.getElementById('dropZone');
    const fileInput = document.getElementById('fileInput');

    // Mở cửa sổ chọn file khi click
    dropZone.addEventListener('click', () => fileInput.click());

    // Xử lý hiệu ứng khi kéo file vào
    dropZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropZone.style.backgroundColor = '#eef5ff';
        dropZone.style.borderColor = '#2980b9';
    });

    // Xử lý hiệu ứng khi kéo file ra
    dropZone.addEventListener('dragleave', (e) => {
        e.preventDefault();
        dropZone.style.backgroundColor = '#f8fbff';
        dropZone.style.borderColor = '#3498db';
    });

    // Xử lý khi thả file vào
    dropZone.addEventListener('drop', (e) => {
        e.preventDefault();
        dropZone.style.backgroundColor = '#f8fbff';
        dropZone.style.borderColor = '#3498db';
        
        if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
            fileInput.files = e.dataTransfer.files;
            handleFileSelect({ target: fileInput });
        }
    });

    function handleFileSelect(event) {
        const file = event.target.files[0];
        if (!file) return;
        selectedFile = file;
        
        document.getElementById('predictBtn').disabled = false;
        document.getElementById('dropZone').innerHTML = `<h3 style="color:#2ecc71;">✅ Đã chọn ảnh: ${file.name}</h3>`;
        
        // Load image to canvas to preview
        const reader = new FileReader();
        reader.onload = function(e) {
            imgObj = new Image();
            imgObj.onload = function() {
                drawToCanvas(imgObj, []);
                document.getElementById('resultArea').style.display = 'flex';
                document.getElementById('classificationResult').innerHTML = "<i>Đang chờ phân tích...</i>";
                document.getElementById('detectionResult').innerHTML = "";
                document.getElementById('debugLogs').innerHTML = "";
            }
            imgObj.src = e.target.result;
        }
        reader.readAsDataURL(file);
    }

    function drawToCanvas(img, boxes) {
        const canvas = document.getElementById('imageCanvas');
        const ctx = canvas.getContext('2d');
        
        canvas.width = img.width;
        canvas.height = img.height;
        ctx.drawImage(img, 0, 0);

        // Draw bounding boxes
        boxes.forEach(box => {
            const [x1, y1, x2, y2] = box.box;
            const name = box.name;
            const conf = (box.confidence * 100).toFixed(1) + '%';
            
            const isHealthy = name.toLowerCase().includes('khoe') || name.toLowerCase().includes('healthy');
            const color = isHealthy ? '#2ecc71' : '#e74c3c'; // Xanh nếu khỏe, Đỏ nếu bệnh
            
            ctx.strokeStyle = color;
            ctx.lineWidth = Math.max(3, img.width / 200);
            ctx.strokeRect(x1, y1, x2 - x1, y2 - y1);
            
            // Draw label background
            ctx.fillStyle = color;
            const text = `${name} ${conf}`;
            const fontSize = Math.max(16, img.width / 40);
            ctx.font = `bold ${fontSize}px Arial`;
            const textWidth = ctx.measureText(text).width;
            ctx.fillRect(x1, y1 - fontSize - 10, textWidth + 10, fontSize + 10);
            
            // Draw text
            ctx.fillStyle = 'white';
            ctx.fillText(text, x1 + 5, y1 - 5);
        });
    }

    async function runPrediction() {
        if (!selectedFile) return;
        
        document.getElementById('predictBtn').disabled = true;
        document.getElementById('loader').style.display = 'block';
        
        const formData = new FormData();
        formData.append('image', selectedFile);

        try {
            const response = await fetch('/api/predict', {
                method: 'POST',
                body: formData
            });
            const data = await response.json();
            
            document.getElementById('loader').style.display = 'none';
            document.getElementById('predictBtn').disabled = false;
            
            if (data.success) {
                // Update Classification
                let clsHtml = `<h4>Loại Cây: <span style="color:#2c3e50;">${data.plant_vn}</span></h4>`;
                clsHtml += `<p>Mã hệ thống: ${data.plant_name}</p>`;
                clsHtml += `<span class="badge">Độ tin cậy: ${(data.cls_confidence * 100).toFixed(1)}%</span>`;
                document.getElementById('classificationResult').innerHTML = clsHtml;
                
                // Update Detection
                if (data.detections && data.detections.length > 0) {
                    let detHtml = `<div>Tìm thấy <b>${data.detections.length}</b> vấn đề:</div>`;
                    data.detections.forEach(d => {
                        detHtml += `
                        <div class="detection-item">
                            <b>${d.name}</b> 
                            <span>${(d.confidence * 100).toFixed(1)}%</span>
                        </div>`;
                    });
                    document.getElementById('detectionResult').innerHTML = detHtml;
                } else {
                    document.getElementById('detectionResult').innerHTML = `<h4 style="color:#2ecc71;">✅ Không tìm thấy bệnh! (Hoặc cây khỏe mạnh)</h4>`;
                }
                
                // Redraw image with boxes
                drawToCanvas(imgObj, data.detections);
                
                // Debug logs
                document.getElementById('debugLogs').innerHTML = data.debug_info.join('<br>');
                
            } else {
                document.getElementById('classificationResult').innerHTML = `<h4 style="color:red;">❌ Lỗi: ${data.error}</h4>`;
            }
            
        } catch (error) {
            document.getElementById('loader').style.display = 'none';
            document.getElementById('predictBtn').disabled = false;
            alert("Lỗi kết nối tới server!");
            console.error(error);
        }
    }
</script>
</body>
</html>
"""

@app.route('/')
def home():
    return render_template_string(HTML_TEMPLATE)

@app.route('/api/predict', methods=['POST'])
def predict_api():
    if 'image' not in request.files:
        return jsonify({"success": False, "error": "No image uploaded"})
        
    file = request.files['image']
    if file.filename == '':
        return jsonify({"success": False, "error": "No image selected"})
        
    # Lưu file tạm thời
    filename = secure_filename(f"{uuid.uuid4().hex}_{file.filename}")
    filepath = os.path.join(UPLOAD_FOLDER, filename)
    file.save(filepath)
    
    # Chạy inference qua hàm mà bạn vừa cung cấp
    try:
        result = run_inference(filepath)
    except Exception as e:
        result = {"success": False, "error": str(e)}
        
    # Tùy chọn: Xóa file sau khi predict để dọn dẹp
    # if os.path.exists(filepath):
    #     os.remove(filepath)
        
    return jsonify(result)

if __name__ == '__main__':
    print("🚀 Bắt đầu chạy Web UI Local Server tại http://127.0.0.1:5000")
    print("Vui lòng mở link trên bằng trình duyệt của bạn!")
    app.run(host='127.0.0.1', port=5000, debug=True)
