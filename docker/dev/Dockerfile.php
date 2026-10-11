FROM composer:2 AS composer
FROM php:8.3-apache-bookworm
RUN apt-get update && apt-get install -y --no-install-recommends libicu-dev libzip-dev libsqlite3-dev libonig-dev python3 rsync git unzip curl mariadb-client \
    && docker-php-ext-install -j1 intl pdo_mysql pdo_sqlite mbstring zip \
    && a2enmod rewrite headers \
    && sed -i 's,/var/www/html,/workspace/public,g' /etc/apache2/sites-available/000-default.conf \
    && printf '<Directory /workspace/public>\nAllowOverride All\nRequire all granted\n</Directory>\n' > /etc/apache2/conf-available/inkgroove-dev.conf \
    && a2enconf inkgroove-dev && rm -rf /var/lib/apt/lists/*
COPY --from=composer /usr/bin/composer /usr/local/bin/composer
RUN printf 'memory_limit=512M\n' > /usr/local/etc/php/conf.d/inkgroove-dev.ini \
    && printf '<IfModule mpm_prefork_module>\nStartServers 2\nMinSpareServers 2\nMaxSpareServers 2\nServerLimit 2\nMaxRequestWorkers 2\nMaxConnectionsPerChild 500\n</IfModule>\n' > /etc/apache2/mods-available/mpm_prefork.conf
ENV COMPOSER_ALLOW_SUPERUSER=1 COMPOSER_MEMORY_LIMIT=512M
WORKDIR /workspace
