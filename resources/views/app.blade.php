<!doctype html>
<html lang="es">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="csrf-token" content="{{ csrf_token() }}">
    <meta name="description" content="Crea, certifica y entrega documentos con un registro verificable de su proceso de escritura.">
    <title>InkGroove</title>
    <link rel="icon" type="image/svg+xml" href="/favicon.svg">
    @vite('resources/js/main.tsx')
</head>
<body>
    <div id="root"></div>
    <script>window.__VERITAS_USER__ = @json(auth()->user());</script>
</body>
</html>
