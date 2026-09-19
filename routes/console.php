<?php

use Illuminate\Support\Facades\Artisan;

Artisan::command('veritas:about', function (): void {
    $this->info('Veritas v0.3 · documentos con trazabilidad verificable');
})->purpose('Muestra información de esta instalación');
