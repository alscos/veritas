<!doctype html>
<html lang="{{ app()->getLocale() }}">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="csrf-token" content="{{ csrf_token() }}"><title>InkGroove · {{ app()->getLocale() === 'en' ? 'Sealed version' : 'Versión sellada' }}</title>
@vite('resources/js/versionShareMain.tsx')
</head>
<body><div id="version-share" data-document="{{ $document ?? '' }}" data-version="{{ $version ?? '' }}"></div></body>
</html>
