import json
import os

manifest = json.load(open('benchmark-output/previews/manifest.json', encoding='utf-8'))
results = json.load(open('benchmark-output/benchmark-results.json', encoding='utf-8'))['results']

print(f"=== DETAILED IMAGE-BY-IMAGE COMPARISON ({len(manifest)} IMAGES) ===\n")
for item in manifest:
    img_id = item['id']
    fname = item['filename']
    w = item['width']
    h = item['height']
    dets = item['detections']
    print(f"Image #{img_id}: {fname} ({w}x{h})")
    for det_name in ['CURRENT', 'SCANIC_ML', 'QUADSCAN', 'SCANIC_CLASSICAL', 'HYBRID_SCANIC']:
        d = dets.get(det_name, {})
        c = d.get('corners')
        conf = d.get('confidence')
        area = d.get('area_ratio')
        ms = d.get('duration_ms')
        valid = d.get('geometry_valid')
        if c:
            tl = f"({c[0]['x']:.3f}, {c[0]['y']:.3f})"
            tr = f"({c[1]['x']:.3f}, {c[1]['y']:.3f})"
            br = f"({c[2]['x']:.3f}, {c[2]['y']:.3f})"
            bl = f"({c[3]['x']:.3f}, {c[3]['y']:.3f})"
            print(f"  {det_name:<16}: conf={str(conf):<6} area={area:<6} {ms:>6.1f}ms | TL={tl} TR={tr} BR={br} BL={bl}")
        else:
            print(f"  {det_name:<16}: NO CORNERS / ERROR: {d.get('error')}")
    print()
