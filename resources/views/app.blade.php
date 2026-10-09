<!doctype html>
<html lang="{{ app()->getLocale() }}">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="csrf-token" content="{{ csrf_token() }}">
    <meta name="description" content="{{ __('inkgroove.description') }}">
    <title>InkGroove</title>
    <link rel="icon" type="image/svg+xml" href="/favicon.svg">
    @vite('resources/js/main.tsx')
</head>
<body>
    <div id="root"></div>
    <script>window.__VERITAS_USER__ = @json(auth()->user());</script>
</body>
</html>
