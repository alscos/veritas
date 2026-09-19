<?php

namespace Database\Seeders;

use App\Models\Document;
use App\Models\User;
use Illuminate\Database\Seeder;

class DatabaseSeeder extends Seeder
{
    public function run(): void
    {
        if (!app()->environment('local')) return;
        $student = User::firstOrCreate(['email' => 'alumno@veritas.local'], ['name' => 'Alumno de prueba', 'password' => 'veritas-demo-2026']);
        User::firstOrCreate(['email' => 'profesor@veritas.local'], ['name' => 'Profesor de prueba', 'password' => 'veritas-demo-2026']);
        Document::firstOrCreate(['owner_id' => $student->id, 'title' => 'Primer documento'], ['content_html' => '<p>Este documento permite comprobar el editor de Veritas.</p>', 'content_text' => 'Este documento permite comprobar el editor de Veritas.', 'word_count' => 9]);
    }
}
