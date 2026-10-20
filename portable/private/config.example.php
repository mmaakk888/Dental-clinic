<?php
declare(strict_types=1);
if (!defined('CLINIC_INTERNAL')) { http_response_code(404); exit; }
// Copy OUTSIDE htdocs as clinic-private/config.php. Never commit real secrets.
return [
    'app_url' => 'https://your-domain.example',
    'app_key' => '', // At least 32 random bytes, e.g. php -r "echo bin2hex(random_bytes(32));"
    'install_token' => '', // Different random value, required only for first owner setup.
    'database' => ['host' => 'localhost', 'port' => 3306, 'name' => '', 'user' => '', 'password' => '', 'charset' => 'utf8mb4'],
    'timezone' => 'Africa/Cairo',
    'session_seconds' => 43200,
    'remember_seconds' => 604800,
    'max_upload_bytes' => 153600,
    'max_logo_bytes' => 2097152,
    'allow_http_loopback' => false,
    // No private decryption key belongs here. Configure credentials directly on
    // the new host, never in the UI, GitHub, a backup or JavaScript.
    'backup' => [
        'hosting_profile'=>'unknown', // unknown | infinityfree (no cron) | cron
        'max_plain_bytes'=>16777216, 'max_attachment_bytes'=>5242880,
        'smtp'=>['host'=>'','port'=>587,'encryption'=>'tls','username'=>'','password'=>'','from'=>''],
        // An existing PRIVATE WebDAV folder on a DIFFERENT HTTPS host. We verify
        // PUT + authenticated GET + unauthenticated denial before emailing it.
        'webdav'=>['url'=>'','username'=>'','password'=>''],
    ],
    // Optional external AI. No PHI is sent until both flags are explicitly enabled.
    // Verify a current model in your provider account. Never put this key in JS.
    'ai' => ['enabled'=>false,'allow_external_data'=>false,'api_key'=>'','model'=>''],
];
