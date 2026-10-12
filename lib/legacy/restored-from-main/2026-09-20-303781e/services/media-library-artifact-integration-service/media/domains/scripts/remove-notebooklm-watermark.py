import cv2
import numpy as np
from pathlib import Path

INPUT_DIR = Path("input_pngs")
OUTPUT_DIR = Path("output_pngs")
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

# Estimated watermark region (tweak once, then reuse)
MASK_WIDTH = 180
MASK_HEIGHT = 80
PADDING = 10

for img_path in INPUT_DIR.glob("*.png"):
    img = cv2.imread(str(img_path))
    h, w, _ = img.shape

    mask = np.zeros((h, w), dtype=np.uint8)

    x1 = w - MASK_WIDTH - PADDING
    y1 = h - MASK_HEIGHT - PADDING
    x2 = w - PADDING
    y2 = h - PADDING

    mask[y1:y2, x1:x2] = 255

    result = cv2.inpaint(img, mask, inpaintRadius=3, flags=cv2.INPAINT_TELEA)
    cv2.imwrite(str(OUTPUT_DIR / img_path.name), result)

print("Done.")
