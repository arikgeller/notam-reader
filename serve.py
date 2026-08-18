# Local dev server for testing NOTAM Reader (not part of the app).
import os, http.server, socketserver
os.chdir(os.path.dirname(os.path.abspath(__file__)))
class H(http.server.SimpleHTTPRequestHandler):
    protocol_version = 'HTTP/1.1'
    def end_headers(self):
        if not self.path.endswith('service-worker.js'):
            self.send_header('Cache-Control', 'no-store')
        super().end_headers()
socketserver.TCPServer.allow_reuse_address = True
socketserver.ThreadingTCPServer(('127.0.0.1', 8731), H).serve_forever()
