<?php

namespace Tests;

abstract class TestCase extends \Illuminate\Foundation\Testing\TestCase
{
    // Runs before setUpTraits()/RefreshDatabase. PHPUnit force=true does not
    // replace Docker's $_SERVER entries, which Laravel may prefer over getenv.
    public function createApplication()
    {
        $app = parent::createApplication();
        if (!$app->environment('testing') || $app['config']->get('database.default') !== 'sqlite'
            || $app['config']->get('database.connections.sqlite.database') !== ':memory:') {
            throw new \LogicException('PHP tests require testing + SQLite :memory: in the isolated PHP runner; no database refresh is permitted here.');
        }
        return $app;
    }
}
