#!/usr/bin/env python3
"""
YOLO Classification & Detection Inference Script
Quy trình:
1. Phân loại cây (Classification)
2. Nếu xác định được cây, chạy model phát hiện bệnh (Detection)
3. Có hỗ trợ load model chuyên biệt (Specialized Model)
"""

import sys
import json
import os
import cv2
import numpy as np
from ultralytics import YOLO

# Xác định đường dẫn gốc (project root)
# file này nằm ở python/inference.py, nên root là cha của folder python
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# Đường dẫn model (tương tự app.py)
CLS_MODEL_PATH = os.path.join(BASE_DIR, "runs", "classify", "train_crop_type", "weights", "best.pt")
DET_MODEL_PATH = os.path.join(BASE_DIR, "runs", "detect", "train_nano_updated", "weights", "best.pt")
SPECIALIZED_DIR = os.path.join(BASE_DIR, "runs", "detect_specialized")

def get_vn_name(crop_name):
    vn_names = {
        "Ngo": "Ngô (Bắp)", "Lua": "Lúa", "San": "Sắn (Khoai mì)",
        "Ca_Chua": "Cà Chua", "Khoai_Tay": "Khoai Tây", 
        "Ca_Phe": "Cà Phê", "Che": "Chè (Trà)", "Ot": "Ớt"
    }
    return vn_names.get(crop_name, crop_name)

def run_inference(image_path):
    # Kiểm tra file tồn tại
    if not os.path.exists(image_path):
        return {
            "success": False,
            "error": f"Image file not found: {image_path}"
        }

    result_data = {
        "success": True,
        "plant_name": "Unknown",
        "plant_vn": "Không xác định",
        "detections": [],
        "debug_info": []
    }

    try:
        # --- BƯỚC 1: Classification ---
        if not os.path.exists(CLS_MODEL_PATH):
            return {"success": False, "error": f"Classifier model not found at {CLS_MODEL_PATH}"}
            
        cls_model = YOLO(CLS_MODEL_PATH)
        
        # Run classification
        cls_results = cls_model(image_path, verbose=False)
        
        if not cls_results:
            return {"success": False, "error": "Classification failed"}

        top1_idx = cls_results[0].probs.top1
        plant_name = cls_results[0].names[top1_idx]
        conf_cls = float(cls_results[0].probs.top1conf)
        
        result_data["plant_name"] = plant_name
        result_data["plant_vn"] = get_vn_name(plant_name)
        result_data["cls_confidence"] = conf_cls
        result_data["debug_info"].append(f"Classified as: {plant_name} ({conf_cls:.2f})")

        # --- BƯỚC 2: Detection ---
        
        # Check for specialized model
        spec_model_path = os.path.join(SPECIALIZED_DIR, f"{plant_name}_model", "weights", "best.pt")
        used_specialized = False
        
        if os.path.exists(spec_model_path):
            det_model_path = spec_model_path
            used_specialized = True
            result_data["debug_info"].append(f"Using specialized model: {plant_name}")
        else:
            det_model_path = DET_MODEL_PATH
            result_data["debug_info"].append("Using general model")
            
        if not os.path.exists(det_model_path):
             result_data["debug_info"].append(f"Detection model not found at {det_model_path}")
             result_data["unsupported"] = True
             return result_data

        det_model = YOLO(det_model_path)
        
        # Run detection
        det_results = det_model(image_path, verbose=False)
        
        if not det_results:
             # Không tìm thấy bệnh cũng là một kết quả hợp lệ (cây khỏe)
             return result_data

        det_result = det_results[0]
        boxes = det_result.boxes
        names = det_result.names
        
        # --- BƯỚC 3: Filtering (Lọc kết quả theo loại cây) ---
        # Logic from app.py
        filtered_detections = []
        valid_prefix = plant_name
        
        for box in boxes:
            cls_id = int(box.cls[0])
            name = names[cls_id]
            conf = float(box.conf[0])
            
            is_match = False
            # Trường hợp 1: Bắt đầu bằng "TenCay_" (Che_...)
            if name.lower().startswith(valid_prefix.lower() + "_"):
                is_match = True
            # Trường hợp 2: Trùng tên hoàn toàn
            elif name.lower() == valid_prefix.lower():
                is_match = True
                
            # Loại bỏ nếu là nhãn "Khỏe mạnh" (không phải là bệnh)
            if "khoe" in name.lower() or "healthy" in name.lower():
                is_match = False
            
            # Nếu dùng specialized model, ta có thể tin tưởng hơn, nhưng vẫn nên lọc để tránh nhiễu
            if is_match:
                detection_info = {
                    "name": name,
                    "confidence": conf,
                    "box": box.xyxy[0].tolist() # [x1, y1, x2, y2]
                }
                filtered_detections.append(detection_info)
        
        result_data["detections"] = filtered_detections
        
        if len(filtered_detections) < len(boxes):
             result_data["debug_info"].append(f"Filtered {len(boxes) - len(filtered_detections)} noise detections")

        return result_data

    except Exception as e:
        return {
            "success": False,
            "error": str(e)
        }

def main():
    if len(sys.argv) < 2:
        print(json.dumps({"success": False, "error": "Usage: python inference.py <image_path>"}))
        sys.exit(1)
    
    image_path = sys.argv[1]
    result = run_inference(image_path)
    
    # In kết quả JSON để Node.js đọc
    print(json.dumps(result, ensure_ascii=False))
    
    sys.exit(0)

if __name__ == "__main__":
    main()
