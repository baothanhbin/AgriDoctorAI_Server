#!/usr/bin/env python3
"""
YOLO Classification Script - Chỉ nhận diện loại cây
Trả về kết quả phân loại cây từ ảnh
"""

import sys
import json
import os
from ultralytics import YOLO

# Xác định đường dẫn gốc (project root)
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# Đường dẫn model classification
CLS_MODEL_PATH = os.path.join(BASE_DIR, "runs", "classify", "train_crop_type", "weights", "best.pt")

def get_vn_name(crop_name):
    """Chuyển đổi tên cây sang tiếng Việt"""
    vn_names = {
        "Ngo": "Ngô (Bắp)", 
        "Lua": "Lúa", 
        "San": "Sắn (Khoai mì)",
        "Ca_Chua": "Cà Chua", 
        "Khoai_Tay": "Khoai Tây", 
        "Ca_Phe": "Cà Phê", 
        "Che": "Chè (Trà)", 
        "Ot": "Ớt"
    }
    return vn_names.get(crop_name, crop_name)

def classify_image(image_path):
    """
    Chạy classification để nhận diện loại cây
    Trả về JSON với kết quả phân loại
    """
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
        "confidence": 0.0,
        "top_predictions": []
    }

    try:
        # Kiểm tra model có tồn tại không
        if not os.path.exists(CLS_MODEL_PATH):
            return {
                "success": False, 
                "error": f"Classifier model not found at {CLS_MODEL_PATH}"
            }
            
        # Load model
        cls_model = YOLO(CLS_MODEL_PATH)
        
        # Run classification
        cls_results = cls_model(image_path, verbose=False)
        
        if not cls_results:
            return {"success": False, "error": "Classification failed"}

        result = cls_results[0]
        
        # Lấy top 1 prediction
        top1_idx = result.probs.top1
        plant_name = result.names[top1_idx]
        conf_cls = float(result.probs.top1conf)
        
        # Lấy top 5 predictions để hiển thị thêm
        top5_indices = result.probs.top5
        top5_confidences = result.probs.top5conf.cpu().numpy()
        
        top_predictions = []
        for idx, conf in zip(top5_indices, top5_confidences):
            class_name = result.names[idx]
            top_predictions.append({
                "name": class_name,
                "name_vn": get_vn_name(class_name),
                "confidence": float(conf)
            })
        
        result_data["plant_name"] = plant_name
        result_data["plant_vn"] = get_vn_name(plant_name)
        result_data["confidence"] = conf_cls
        result_data["top_predictions"] = top_predictions

        return result_data

    except Exception as e:
        return {
            "success": False,
            "error": str(e)
        }

def main():
    """Main function"""
    if len(sys.argv) < 2:
        print(json.dumps({"success": False, "error": "Usage: python classify.py <image_path>"}))
        sys.exit(1)
    
    image_path = sys.argv[1]
    result = classify_image(image_path)
    
    # In kết quả JSON để Node.js đọc
    print(json.dumps(result, ensure_ascii=False))
    
    sys.exit(0)

if __name__ == "__main__":
    main()

