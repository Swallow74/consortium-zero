#!/usr/bin/env python3
"""Server di sviluppo statico (solo stdlib). Emula missions.php: elenca le cartelle in /missions.
Uso: python3 serve.py [porta]   (default 8080)"""
import http.server, json, os, sys

ROOT = os.path.dirname(os.path.abspath(__file__))
MIS = os.path.join(ROOT, "missions")


def mission_list():
    out = []
    if os.path.isdir(MIS):
        for d in sorted(os.listdir(MIS)):
            if d[0] in "._":
                continue
            if os.path.isfile(os.path.join(MIS, d, "mission.json")):
                out.append({"folder": d, "id": d})
    return {"missions": out}


class H(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **k):
        super().__init__(*a, directory=ROOT, **k)

    def do_GET(self):
        if self.path.split("?")[0] == "/missions.php":
            body = json.dumps(mission_list(), ensure_ascii=False).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Cache-Control", "no-store")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        super().do_GET()

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def log_message(self, *a):
        pass


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8080
    print(f"Consortium Zero su http://localhost:{port}")
    http.server.ThreadingHTTPServer(("127.0.0.1", port), H).serve_forever()
