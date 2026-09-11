# -*- coding: utf-8 -*-
"""
Локальный сервер для проверки покрытия МТС (5G, 4G LTE, 3G, 2G).
Запускает локальный веб-сервер и предоставляет API:
  GET /api/check?lat=55.7903&lon=49.1228
"""

import http.server
import socketserver
import urllib.parse
import urllib.request
import ssl
import math
import json
import io
import os
import sys

PORT = 8080

# Отключаем проверку SSL для тайловых серверов (на случай локальных прокси)
SSL_CTX = ssl.create_default_context()
SSL_CTX.check_hostname = False
SSL_CTX.verify_mode = ssl.CERT_NONE

try:
    from PIL import Image
    HAS_PIL = True
except ImportError:
    HAS_PIL = False
    print("[WARN] Pillow (PIL) не установлена. Анализ прозрачности пикселей будет упрощенным.")

def check_tile_pixel(lat, lon, net_type, zoom=12):
    """
    Определяет попадание точки в зону покрытия МТС:
    Переводит WGS84 координаты в проекцию Яндекс Mercator (EPSG:3395),
    скачивает нужный тайл 256x256 и проверяет непрозрачность (alpha > 20).
    """
    try:
        a = 6378137.0
        c = 0.0818191908426
        r_lat = math.radians(lat)
        r_lon = math.radians(lon)
        x = a * r_lon
        y = a * math.log(math.tan(math.pi / 4.0 + r_lat / 2.0) * ((1.0 - c * math.sin(r_lat)) / (1.0 + c * math.sin(r_lat))) ** (c / 2.0))
        
        k = 2 ** (zoom + 8) / (2 * 20037508.342789244)
        world_x = 20037508.342789244 + x
        world_y = 20037508.342789244 - y
        
        total_px = world_x * k
        total_py = world_y * k
        
        tile_x = int(total_px // 256)
        tile_y = int(total_py // 256)
        px = max(0, min(255, int(total_px % 256)))
        py = max(0, min(255, int(total_py % 256)))
        
        url = f"https://tiles.qsupport.mts.ru/{net_type}/{zoom}/{tile_x}/{tile_y}/"
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"})
        
        with urllib.request.urlopen(req, context=SSL_CTX, timeout=4) as resp:
            data = resp.read()
            # Пустой тайл весит около 330-360 байт (прозрачный 1x1 или 256x256)
            if len(data) < 380:
                return False
            if not HAS_PIL:
                return len(data) > 400
            
            img = Image.open(io.BytesIO(data)).convert("RGBA")
            pixel = img.getpixel((px, py))
            # Alpha > 25 означает наличие заливки зоны покрытия МТС
            return pixel[3] > 25
    except Exception as err:
        return False

class CoverageHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Cache-Control', 'no-cache, no-store, must-revalidate')
        super().end_headers()

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path == '/api/check':
            query = urllib.parse.parse_qs(parsed.query)
            try:
                lat = float(query.get('lat', [0])[0])
                lon = float(query.get('lon', [0])[0])
                
                # Проверяем все стандарты
                results = {
                    "g5_New": check_tile_pixel(lat, lon, "g5_New"),
                    "g5": check_tile_pixel(lat, lon, "g5"),
                    "lte_New": check_tile_pixel(lat, lon, "lte_New"),
                    "g3_New": check_tile_pixel(lat, lon, "g3_New"),
                    "g2_New": check_tile_pixel(lat, lon, "g2_New")
                }
                
                body = json.dumps(results, ensure_ascii=False).encode('utf-8')
                self.send_response(200)
                self.send_header('Content-Type', 'application/json; charset=utf-8')
                self.send_header('Content-Length', str(len(body)))
                self.end_headers()
                self.wfile.write(body)
                return
            except Exception as e:
                self.send_response(500)
                self.end_headers()
                self.wfile.write(f'{{"error": "{e}"}}'.encode('utf-8'))
                return
        
        # Обычная раздача статических файлов
        super().do_GET()

if __name__ == '__main__':
    # Переходим в директорию скрипта
    os.chdir(os.path.dirname(os.path.abspath(__file__)))
    socketserver.TCPServer.allow_reuse_address = True
    with socketserver.TCPServer(("", PORT), CoverageHandler) as httpd:
        print(f"=== Сервер проверки покрытия МТС запущен ===")
        print(f"URL: http://localhost:{PORT}")
        print("Нажмите Ctrl+C для остановки")
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\nСервер остановлен.")
