FROM composer:2 AS php-dependencies
WORKDIR /app
COPY composer.json ./
COPY artisan ./
COPY app ./app
COPY bootstrap ./bootstrap
COPY config ./config
COPY database ./database
COPY routes ./routes
COPY resources/views ./resources/views
RUN composer install --no-dev --no-interaction --prefer-dist --optimize-autoloader

FROM node:22-bookworm-slim AS frontend
WORKDIR /app
COPY package.json package-lock.json tsconfig.json vite.config.ts index.html ./
COPY resources ./resources
RUN npm ci && npm run build

FROM php:8.3-apache-bookworm AS runtime
RUN apt-get update \
    && apt-get install -y --no-install-recommends libicu-dev libzip-dev mariadb-client openssl \
    && docker-php-ext-install intl opcache pdo_mysql zip \
    && a2enmod headers rewrite \
    && rm -rf /var/lib/apt/lists/*

ENV APACHE_DOCUMENT_ROOT=/var/www/html/public
WORKDIR /var/www/html
COPY --from=php-dependencies /app/vendor ./vendor
COPY --from=frontend /app/public/build ./public/build
COPY app ./app
COPY artisan bootstrap config database public resources/views routes ./
COPY docker/apache/000-default.conf /etc/apache2/sites-available/000-default.conf
COPY docker/entrypoint.sh /usr/local/bin/veritas-entrypoint
RUN chmod +x artisan /usr/local/bin/veritas-entrypoint \
    && mkdir -p storage/app storage/framework/cache/data storage/framework/sessions storage/framework/views storage/logs \
    && chown -R www-data:www-data storage bootstrap/cache

EXPOSE 80
ENTRYPOINT ["veritas-entrypoint"]
CMD ["apache2-foreground"]
