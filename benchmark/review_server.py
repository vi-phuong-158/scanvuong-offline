import os
import sys
import json
import csv
from http.server import HTTPServer, SimpleHTTPRequestHandler

PORT = 8766
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
BENCHMARK_OUTPUT = os.path.join(BASE_DIR, "..", "benchmark-output")
PREVIEWS_DIR = os.path.join(BENCHMARK_OUTPUT, "previews")
REVIEW_APP_DIR = os.path.join(BASE_DIR, "review_app")

class BenchmarkReviewHandler(SimpleHTTPRequestHandler):
    def do_GET(self):
        if self.path == "/" or self.path == "/index.html":
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.end_headers()
            with open(os.path.join(REVIEW_APP_DIR, "index.html"), "rb") as fp:
                self.wfile.write(fp.read())
            return

        if self.path == "/api/manifest":
            manifest_path = os.path.join(PREVIEWS_DIR, "manifest.json")
            if os.path.exists(manifest_path):
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                with open(manifest_path, "rb") as fp:
                    self.wfile.write(fp.read())
            else:
                self.send_error(404, "Manifest not found")
            return

        if self.path == "/api/reviews":
            review_path = os.path.join(BENCHMARK_OUTPUT, "review_results.json")
            if os.path.exists(review_path):
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                with open(review_path, "rb") as fp:
                    self.wfile.write(fp.read())
            else:
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(b"{}")
            return

        if self.path.startswith("/previews/"):
            filename = self.path[len("/previews/"):]
            file_path = os.path.join(PREVIEWS_DIR, filename)
            if os.path.exists(file_path):
                self.send_response(200)
                if filename.endswith(".jpg") or filename.endswith(".jpeg"):
                    self.send_header("Content-Type", "image/jpeg")
                elif filename.endswith(".png"):
                    self.send_header("Content-Type", "image/png")
                elif filename.endswith(".json"):
                    self.send_header("Content-Type", "application/json")
                self.end_headers()
                with open(file_path, "rb") as fp:
                    self.wfile.write(fp.read())
                return

        self.send_error(404, "File not found")

    def do_POST(self):
        if self.path == "/api/save_reviews":
            length = int(self.headers.get("Content-Length", 0))
            body = self.rfile.read(length).decode("utf-8")
            raw_data = json.loads(body)

            # Normalize data structure
            normalized = {}
            for img_id, val in raw_data.items():
                if "detectors" in val:
                    normalized[str(img_id)] = val
                else:
                    normalized[str(img_id)] = {
                        "detectors": val,
                        "categories": []
                    }

            # Save JSON
            json_path = os.path.join(BENCHMARK_OUTPUT, "review_results.json")
            with open(json_path, "w", encoding="utf-8") as fp:
                json.dump(normalized, fp, indent=2)

            # Save CSV
            csv_path = os.path.join(BENCHMARK_OUTPUT, "review_results.csv")
            with open(csv_path, "w", encoding="utf-8", newline="") as fp:
                writer = csv.writer(fp)
                writer.writerow(["image_id", "detector", "verdict", "categories"])
                for img_id, review in normalized.items():
                    cats = "|".join(review.get("categories", []))
                    for det, verdict in review.get("detectors", {}).items():
                        writer.writerow([img_id, det, verdict, cats])

            print(f"Saved review annotations: {len(normalized)} images.")
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(b'{"status": "ok"}')
            return

        self.send_error(404, "Unknown endpoint")

def run():
    server = HTTPServer(("127.0.0.1", PORT), BenchmarkReviewHandler)
    print(f"ScanVuong Benchmark Review Server running at: http://127.0.0.1:{PORT}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopping review server.")
        server.server_close()

if __name__ == "__main__":
    run()
