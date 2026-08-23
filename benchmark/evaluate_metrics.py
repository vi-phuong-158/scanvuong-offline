import os
import sys
import json
from collections import defaultdict
import numpy as np

# Force UTF-8 on Windows stdout
sys.stdout.reconfigure(encoding='utf-8')

BENCHMARK_RESULTS_PATH = 'benchmark-output/benchmark-results.json'
REVIEW_RESULTS_PATH = 'benchmark-output/review_results.json'

if not os.path.exists(BENCHMARK_RESULTS_PATH):
    print(f"ERROR: Benchmark results not found at {BENCHMARK_RESULTS_PATH}. Run run_benchmark.js first.")
    sys.exit(1)

if not os.path.exists(REVIEW_RESULTS_PATH):
    print(f"ERROR: Review results not found at {REVIEW_RESULTS_PATH}. User human review is required before evaluating.")
    sys.exit(1)

bench_data = json.load(open(BENCHMARK_RESULTS_PATH, encoding='utf-8'))
reviews_data = json.load(open(REVIEW_RESULTS_PATH, encoding='utf-8'))

VALID_VERDICTS = {'AUTO_OK', 'MINOR_ADJUST', 'WRONG', 'NO_DETECTION'}
REQUIRED_DETECTORS = {'CURRENT', 'SCANIC_ML'}

# Validation
total_images = bench_data['total_images']
reviewed_ids = set(reviews_data.keys())

print(f"=== VALIDATING HUMAN REVIEW INTEGRITY ({len(reviewed_ids)}/{total_images} images) ===\n")

if len(reviewed_ids) != total_images:
    print(f"ERROR: Expected {total_images} reviewed images, but found {len(reviewed_ids)} in review_results.json.")
    sys.exit(1)

missing_ratings = []
invalid_verdicts = []

for img_id, item in reviews_data.items():
    dets = item.get('detectors', item)
    for req in REQUIRED_DETECTORS:
        if req not in dets or not dets[req]:
            missing_ratings.append((img_id, req))
        elif dets[req] not in VALID_VERDICTS:
            invalid_verdicts.append((img_id, req, dets[req]))

if missing_ratings:
    print(f"ERROR: Missing ratings for: {missing_ratings}")
    sys.exit(1)

if invalid_verdicts:
    print(f"ERROR: Invalid verdicts found: {invalid_verdicts}")
    sys.exit(1)

print("[PASS] VALIDATION PASSED: All 25 images have valid human reviews for REQUIRED detectors.\n")

results = bench_data['results']

by_detector_metrics = defaultdict(lambda: {
    'AUTO_OK': 0,
    'MINOR_ADJUST': 0,
    'WRONG': 0,
    'NO_DETECTION': 0,
    'latencies': [],
    'pre_latencies': [],
    'infer_latencies': []
})

for r in results:
    img_id = str(r['image_id'])
    det = r['detector']
    item = reviews_data.get(img_id, {})
    dets = item.get('detectors', item)
    verdict = dets.get(det, 'NO_DETECTION')
    
    m = by_detector_metrics[det]
    m[verdict] += 1
    m['latencies'].append(r['duration_ms'])
    m['pre_latencies'].append(r.get('pre_ms', 0))
    m['infer_latencies'].append(r.get('infer_ms', 0))

print("=== HUMAN REVIEW EVALUATION SUMMARY TABLE ===\n")
headers = ["Detector", "AUTO_OK", "MINOR", "WRONG", "NO_DET", "Auto Success", "Usable Rate", "Major Fail", "Median ms", "P90 ms", "P95 ms", "Pre ms", "Infer ms"]
print(f"| {' | '.join(headers)} |")
print(f"|{'---|' * len(headers)}")

for det in ['CURRENT', 'SCANIC_ML', 'QUADSCAN', 'HYBRID_SCANIC']:
    m = by_detector_metrics[det]
    auto_ok = m['AUTO_OK']
    minor = m['MINOR_ADJUST']
    wrong = m['WRONG']
    no_det = m['NO_DETECTION']
    
    auto_rate = (auto_ok / total_images) * 100
    usable_rate = ((auto_ok + minor) / total_images) * 100
    fail_rate = ((wrong + no_det) / total_images) * 100
    
    lats = sorted(m['latencies'])
    median_lat = np.percentile(lats, 50) if lats else 0
    p90_lat = np.percentile(lats, 90) if lats else 0
    p95_lat = np.percentile(lats, 95) if lats else 0
    
    pre_lats = sorted(m['pre_latencies'])
    median_pre = np.percentile(pre_lats, 50) if pre_lats else 0
    
    infer_lats = sorted(m['infer_latencies'])
    median_infer = np.percentile(infer_lats, 50) if infer_lats else 0
    
    row = [
        f"**{det}**",
        str(auto_ok),
        str(minor),
        str(wrong),
        str(no_det),
        f"{auto_rate:.1f}%",
        f"{usable_rate:.1f}%",
        f"{fail_rate:.1f}%",
        f"{median_lat:.1f}",
        f"{p90_lat:.1f}",
        f"{p95_lat:.1f}",
        f"{median_pre:.1f}",
        f"{median_infer:.1f}"
    ]
    print(f"| {' | '.join(row)} |")

print()
