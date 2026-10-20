<?php
declare(strict_types=1);
// Loopback development helper only, not shipped in htdocs. Never serves private
// files, schema, CLI tools or the source tree through PHP's development server.
if(PHP_SAPI==='cli-server'&&parse_url($_SERVER['REQUEST_URI']??'',PHP_URL_PATH)==='/api/index.php'){require __DIR__.'/api/index.php';exit;}
http_response_code(404);header('Content-Type: application/json');echo '{"ok":false,"error":"Not found"}';
