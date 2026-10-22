<!doctype html>
<html lang="{{ $english ? 'en' : 'es' }}">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>InkGroove · {{ $english ? 'Seal lookup' : 'Consulta del sello' }}</title><link rel="stylesheet" href="/certificate-public.css"></head>
<body><main>
<p class="brand">InkGroove</p>
<h1> {{ $english ? 'Seal lookup' : 'Consulta del sello' }}</h1>
<section class="seal-details" aria-label="{{ $english ? 'Seal details' : 'Datos del sello' }}"><p><code>{{ $code }}</code></p>
@if($issuedAt)<p>{{ $english ? 'Issued at' : 'Fecha de emisión' }}: <time>{{ $issuedAt }}</time></p>@endif
@if($sealFormat)<p>{{ $english ? 'Payload seal format' : 'Formato del sello en el payload' }}: v{{ $sealFormat }}. {{ $sealFormat === 2 ? ($english ? 'Limited historical scope.' : 'Alcance histórico limitado.') : ($english ? 'Full verification requires the authenticated service.' : 'La verificación integral requiere el servicio autenticado.') }}</p>@endif
</section>
<section class="signature-result"><h2>{{ $english ? 'Payload signature' : 'Firma del payload' }}</h2>
<p>{{ $valid ? ($english ? 'Stored payload signature checked.' : 'Firma del payload almacenado comprobada.') : ($english ? 'Stored payload signature could not be validated.' : 'No se ha podido validar la firma del payload almacenado.') }}</p>
<p>{{ $english ? 'This lookup does not perform full process verification.' : 'Esta consulta no realiza una verificación integral del proceso.' }}</p></section>
<section class="limitations"><h2>{{ $english ? 'Scope and limitations' : 'Alcance y limitaciones' }}</h2>
<p>{{ $english ? 'This lookup only checks the payload HMAC. Full process integrity has not been evaluated. Content and process evidence require authentication and authorization.' : 'Esta consulta comprueba sólo el HMAC del payload. No se ha evaluado la integridad completa del proceso. El contenido y las evidencias requieren autenticación y autorización.' }}</p>
<p>{{ $english ? 'This result does not evaluate revocation or withdrawal of access, civil identity, human authorship or use of AI. It is not a qualified electronic signature.' : 'Este resultado no evalúa revocación ni retirada de acceso, identidad civil, autoría humana o uso de IA. No es una firma electrónica cualificada.' }}</p>
<p>{{ $english ? 'This lookup does not compare a PDF file with the sealed snapshot. The exported PDF has no cryptographic signature of its own.' : 'Esta consulta no compara un archivo PDF con la instantánea sellada. El PDF exportado no incorpora una firma criptográfica propia.' }}</p>
</section>
<nav aria-label="{{ $english ? 'Language' : 'Idioma' }}"><a href="?lang=es" lang="es">Español</a> · <a href="?lang=en" lang="en">English</a></nav>
</main></body></html>
