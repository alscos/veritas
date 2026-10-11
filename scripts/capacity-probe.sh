#!/bin/sh
# Development container only. No changes to the image, host or production.
set -eu
case "${1:-}" in
 install)
  docker exec inkgroove-dev-app sh -ec 'test ! -e /etc/apache2/conf-enabled/inkgroove-capacity.conf; printf "php_value auto_prepend_file /workspace/scripts/capacity-php-probe.php\n" > /etc/apache2/conf-enabled/inkgroove-capacity.conf; apachectl -t; apachectl graceful'
  ;;
 remove)
  docker exec inkgroove-dev-app sh -ec 'test -f /etc/apache2/conf-enabled/inkgroove-capacity.conf; grep -Eq "^php_value auto_prepend_file (/workspace/scripts/capacity-php-probe.php|/tmp/inkgroove-capacity-probe.php)$" /etc/apache2/conf-enabled/inkgroove-capacity.conf; test "$(wc -l < /etc/apache2/conf-enabled/inkgroove-capacity.conf)" -eq 1; rm /etc/apache2/conf-enabled/inkgroove-capacity.conf; apachectl -t; apachectl graceful; rm -f /tmp/inkgroove-capacity-probe.php /tmp/inkgroove-capacity-php.jsonl /tmp/inkgroove-capacity-sessions.jsonl'
  ;;
 *) echo 'Usage: sh scripts/capacity-probe.sh install|remove' >&2; exit 1 ;;
esac
