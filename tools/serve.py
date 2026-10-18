"""Local dev server for Molten: plain static files, but never cached by the browser,
so a reload always shows the files as they are on disk. Usage: python3 tools/serve.py [port]"""
import functools
import http.server
import os
import sys


class NoStore(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def send_head(self):
        # ignore If-Modified-Since: a 304 would hand back whatever the browser kept
        del self.headers["If-Modified-Since"]
        return super().send_head()


root = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
port = int(sys.argv[1]) if len(sys.argv) > 1 else 5181
http.server.ThreadingHTTPServer(("127.0.0.1", port), functools.partial(NoStore, directory=root)).serve_forever()
