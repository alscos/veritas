<?php
// Standalone synthetic parity runner; no Laravel bootstrap, DB or configuration.
require __DIR__.'/../app/Support/HistoricalWordCounts.php';
$fixtures = json_decode(file_get_contents(__DIR__.'/../tests/Fixtures/m33b-word-counts.json'), true, 64, JSON_THROW_ON_ERROR);
$out = [];
foreach ($fixtures as $fixture) $out[$fixture['id']] = \App\Support\HistoricalWordCounts::analyze($fixture['html']);
echo json_encode((object) $out, JSON_THROW_ON_ERROR);
