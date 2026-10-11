<?php
// Temporary auto_prepend_file on the development Apache only.
// No bodies, cookies, query values, identifiers or credentials are recorded.
register_shutdown_function(function () {
    if (PHP_SAPI !== 'apache2handler' || ($_SERVER['HTTP_X_CAPACITY_PROBE']??'') !== '1') return;
    if (function_exists('app') && app()->bound('request') && app('request')->hasSession()) {
        $id=app('request')->session()->getId();
        if ($id) {
            $registry='/tmp/inkgroove-capacity-sessions.jsonl';
            file_put_contents($registry,json_encode(['sha256'=>hash('sha256',$id)]).PHP_EOL,FILE_APPEND|LOCK_EX);
            chmod($registry,0600);
        }
    }
    $path=parse_url($_SERVER['REQUEST_URI']??'',PHP_URL_PATH);
    $kind=str_ends_with($path,'/timeline')?'timeline':(str_ends_with($path,'/events')?'events':($_SERVER['REQUEST_METHOD']??'unknown'));
    file_put_contents('/tmp/inkgroove-capacity-php.jsonl',json_encode(['kind'=>$kind,'status'=>http_response_code(),'allocated_peak'=>memory_get_peak_usage(true),'used_peak'=>memory_get_peak_usage(false)]).PHP_EOL,FILE_APPEND|LOCK_EX);
});
