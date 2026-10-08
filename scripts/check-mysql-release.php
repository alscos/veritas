<?php

declare(strict_types=1);

require dirname(__DIR__).'/vendor/autoload.php';
$app = require dirname(__DIR__).'/bootstrap/app.php';
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();
$db = $app['db']->connection();
if ($db->getDriverName() !== 'mysql') throw new RuntimeException('This smoke test requires real MySQL.');
$db->transaction(function () use ($db): void {
    $id = $db->table('users')->insertGetId(['name' => 'CI', 'email' => 'ci@example.invalid', 'password' => 'not-a-login']);
    $document = (string) Illuminate\Support\Str::uuid();
    $db->table('documents')->insert(['id' => $document, 'owner_id' => $id]);
    $row = $db->table('documents')->where('id', $document)->first();
    if ($row->content_html !== '' || $row->content_text !== '' || $row->word_count !== 0) throw new RuntimeException('Empty document defaults are invalid on MySQL.');
    $text = "Pingüino: áéíóú ñ\n\nSegundo párrafo 🖋️";
    $db->table('documents')->where('id', $document)->update(['content_html' => '<p>'.$text.'</p>', 'content_text' => $text]);
    if ($db->table('documents')->where('id', $document)->value('content_text') !== $text) throw new RuntimeException('utf8mb4 round-trip failed.');
    $db->table('documents')->where('id', $document)->delete();
    $db->table('users')->where('id', $id)->delete();
});
echo "MySQL: empty defaults and Unicode round-trip OK.\n";
