import os
import sys
import json
import hashlib
from PIL import Image, ExifTags

DATASET_DIR = r"G:\My Drive\CamScaner"
OUTPUT_DIR = os.path.join(os.path.dirname(__file__), "..", "benchmark-output")
os.makedirs(OUTPUT_DIR, exist_ok=True)

SUPPORTED_EXTS = {".jpg", ".jpeg", ".png", ".webp"}

def get_exif_orientation(img):
    try:
        exif = img._getexif()
        if not exif:
            return 1
        for tag, value in exif.items():
            if ExifTags.TAGS.get(tag) == 'Orientation':
                return value
    except Exception:
        pass
    return 1

def run_inventory():
    if not os.path.exists(DATASET_DIR):
        print(f"ERROR: Dataset directory not found: {DATASET_DIR}")
        sys.exit(1)

    items = []
    seen_hashes = {}
    duplicates = []

    for root, _, files in os.walk(DATASET_DIR):
        for f in sorted(files):
            ext = os.path.splitext(f)[1].lower()
            if ext not in SUPPORTED_EXTS:
                continue

            full_path = os.path.join(root, f)
            rel_path = os.path.relpath(full_path, DATASET_DIR)
            file_size = os.path.getsize(full_path)

            hasher = hashlib.sha256()
            with open(full_path, "rb") as fp:
                while chunk := fp.read(65536):
                    hasher.update(chunk)
            sha256 = hasher.hexdigest()

            width, height, orientation = 0, 0, 1
            try:
                with Image.open(full_path) as img:
                    width, height = img.size
                    orientation = get_exif_orientation(img)
            except Exception as e:
                print(f"Warning: could not read image metadata for {f}: {e}")

            if sha256 in seen_hashes:
                duplicates.append({
                    "original": seen_hashes[sha256],
                    "duplicate": rel_path,
                    "sha256": sha256
                })
            else:
                seen_hashes[sha256] = rel_path

            items.append({
                "id": len(items) + 1,
                "relative_path": rel_path.replace("\\", "/"),
                "filename": f,
                "extension": ext,
                "width": width,
                "height": height,
                "aspect_ratio": round(width / max(1, height), 4),
                "orientation": orientation,
                "file_size_bytes": file_size,
                "sha256": sha256
            })

    output_path = os.path.join(OUTPUT_DIR, "inventory.json")
    with open(output_path, "w", encoding="utf-8") as out_fp:
        json.dump({
            "dataset_dir": DATASET_DIR,
            "total_images": len(items),
            "unique_images": len(seen_hashes),
            "duplicate_count": len(duplicates),
            "duplicates": duplicates,
            "images": items
        }, out_fp, indent=2)

    print(f"Inventory complete:")
    print(f"  Total image files scanned: {len(items)}")
    print(f"  Unique images: {len(seen_hashes)}")
    print(f"  Duplicates: {len(duplicates)}")
    print(f"  Saved to: {output_path}")

if __name__ == "__main__":
    run_inventory()
