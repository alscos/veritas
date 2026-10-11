<?php
// Temporary dev Apache prepend. Register exact OWN session hashes, never cookies.
register_shutdown_function(function () {
    if (PHP_SAPI!=='apache2handler') return;
    $file='/workspace/storage/app/chromium-real.json';
    if (!is_file($file)) return;
    $m=json_decode(file_get_contents($file),true);
    if (!$m || ($_SERVER['HTTP_X_CHROMIUM_REAL_RUN']??'')!==$m['run']) return;
    if (function_exists('app') && app()->bound('request') && app('request')->hasSession()) {
        $id=app('request')->session()->getId();
        if ($id) { file_put_contents($m['session_registry'],json_encode(['sha256'=>hash('sha256',$id)]).PHP_EOL,FILE_APPEND|LOCK_EX); chmod($m['session_registry'],0600); }
    }
});
