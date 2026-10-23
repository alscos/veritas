<?php
/** Standalone opt-in synthetic test. No Laravel boot, .env, migrations or persistent tables.
 * M34I_MYSQL_DSN='mysql:host=127.0.0.1;port=3307;dbname=m34i_synthetic'
 * M34I_MYSQL_USER=... M34I_MYSQL_PASSWORD=... php tests/integration/certificate-json-roundtrip.php
 * M34I_MYSQL_REQUIRE_84=1 additionally requires MySQL 8.4 (CI).
 * Provision a disposable local database/account separately. Never use installed databases.
 */
require dirname(__DIR__, 2).'/app/Support/CertificatePayload.php';
use App\Support\CertificatePayload;
$dsn = getenv('M34I_MYSQL_DSN');
if (!$dsn) { fwrite(STDERR, "SKIP: explicit disposable local MySQL DSN unavailable\n"); exit(77); }
if (!preg_match('/^mysql:host=127\.0\.0\.1;port=[0-9]+;dbname=m34i_synthetic$/D', $dsn)) {
    throw new RuntimeException('Only the explicit local synthetic database is allowed');
}
$db = new PDO($dsn, getenv('M34I_MYSQL_USER'), getenv('M34I_MYSQL_PASSWORD'), [PDO::ATTR_ERRMODE=>PDO::ERRMODE_EXCEPTION]);
$serverVersion = $db->getAttribute(PDO::ATTR_SERVER_VERSION);
if (getenv('M34I_MYSQL_REQUIRE_84') === '1' && !preg_match('/^8\.4\./', $serverVersion)) {
    throw new RuntimeException('MySQL 8.4 required');
}
$db->exec('CREATE TEMPORARY TABLE m34i_payload_roundtrip (id INT PRIMARY KEY, payload JSON NOT NULL)');
$check = function (bool $ok, string $label): void { if (!$ok) throw new RuntimeException($label); };
$put = $db->prepare('INSERT INTO m34i_payload_roundtrip VALUES (?, ?)');
$read = $db->prepare('SELECT payload FROM m34i_payload_roundtrip WHERE id = ?');
$roundtrip = function (int $id, array $p) use ($put,$read): array {
    $put->execute([$id,json_encode($p,JSON_THROW_ON_ERROR)]);$read->execute([$id]);
    return json_decode($read->fetchColumn(),true,512,JSON_THROW_ON_ERROR);
};
// page_settings is itself a JSON column read before the historical emitter signs.
$settings=$roundtrip(1,['orientation'=>'portrait','format'=>'a4','margin'=>20]);
foreach ([2,3] as $format) {
    $p=['format_version'=>$format,'page_settings'=>$settings,'history_boundary'=>[
        'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'=>['sequence'=>2,'event_id'=>123,'hash'=>str_repeat('a',64)],
        'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'=>['sequence'=>1,'event_id'=>124,'hash'=>str_repeat('b',64)]],
        'images'=>[], 'list'=>['á', 'é', 20, true, null], 'snapshot'=>'á génesis / <p></p>'];ksort($p);
    $legacy=json_encode($p,JSON_UNESCAPED_SLASHES|JSON_THROW_ON_ERROR);
    $sig=hash_hmac('sha256',$legacy,'synthetic-only');$loaded=$roundtrip($format,$p);ksort($loaded);
    $naive=hash_equals($sig,hash_hmac('sha256',json_encode($loaded,JSON_UNESCAPED_SLASHES|JSON_THROW_ON_ERROR),'synthetic-only'));
    if (!str_contains($db->getAttribute(PDO::ATTR_SERVER_VERSION),'MariaDB')) $check(!$naive,'Expected pre-fix MySQL JSON ordering reproduction');
    $check(CertificatePayload::matches($loaded,$sig,'synthetic-only'),'Historical reconstruction');
    $check(!CertificatePayload::matches($loaded,str_repeat('0',64),'synthetic-only'),'Historical signature rejection');
    $bad=$loaded;$bad['snapshot'].='altered';
    $check(!CertificatePayload::matches($bad,$sig,'synthetic-only'),'Historical payload rejection');
    $p['payload_encoding']=CertificatePayload::ENCODING;
    $sig=hash_hmac('sha256',CertificatePayload::encode($p),'synthetic-only');$loaded=$roundtrip($format+10,$p);
    $check(CertificatePayload::matches($loaded,$sig,'synthetic-only'),'New profile');
    $check(CertificatePayload::encode($loaded) === CertificatePayload::encode($p),'Exact profile bytes after JSON round-trip');
    $check(!CertificatePayload::matches($loaded,str_repeat('0',64),'synthetic-only'),'New signature rejection');
    $bad=$loaded;$bad['list']=array_reverse($bad['list']);
    $check(!CertificatePayload::matches($bad,$sig,'synthetic-only'),'List order rejection');
    $bad=$loaded;$bad['page_settings']['margin']='20';
    $check(!CertificatePayload::matches($bad,$sig,'synthetic-only'),'Scalar type rejection');
    $loaded['history_boundary'][array_key_first($loaded['history_boundary'])]['sequence']++;
    $check(!CertificatePayload::matches($loaded,$sig,'synthetic-only'),'Tamper rejection');
    echo "PASS format=$format legacy_naive=".($naive?'pass':'mismatch')." recovered=yes new=yes tamper=rejected\n";
}
