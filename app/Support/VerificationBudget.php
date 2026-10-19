<?php
namespace App\Support;

/** Cooperative guards: a database call cannot be interrupted by this clock. */
final class VerificationBudget
{
    private float $started;
    private int $memory;
    public array $used = ['events' => 0, 'sessions' => 0, 'images' => 0, 'data_bytes' => 0, 'image_bytes' => 0, 'rows' => 0];
    public function __construct(public readonly array $limits)
    {
        $this->started = microtime(true);
        $this->memory = memory_get_usage();
    }
    public function guard(): void
    {
        if ($this->elapsed() > $this->limits['seconds'] || memory_get_usage() - $this->memory > $this->limits['memory_bytes']) throw new VerificationBudgetExceeded;
    }
    public function add(string $kind, int $amount = 1): void
    {
        $this->guard();
        if (isset($this->limits[$kind]) && $this->used[$kind] + $amount > $this->limits[$kind]) throw new VerificationBudgetExceeded;
        $this->used[$kind] += $amount;
    }
    public function reserveData(int $bytes): void
    {
        $this->guard();
        if ($bytes > $this->limits['row_bytes'] || $this->used['data_bytes'] + $bytes > $this->limits['data_bytes']) throw new VerificationBudgetExceeded;
    }
    public function elapsed(): float { return microtime(true) - $this->started; }
    public function consumed(): array
    {
        return $this->used + ['elapsed_ms' => round($this->elapsed() * 1000, 3), 'php_memory_delta_bytes' => max(0, memory_get_usage() - $this->memory), 'time_control' => 'cooperative'];
    }
}
