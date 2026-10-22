<?php
namespace App\Support;
final class EvidenceFailure extends \RuntimeException
{
    public function __construct(public readonly string $reason, public readonly string $state) { parent::__construct($reason); }
}
