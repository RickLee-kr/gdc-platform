FROM nginx:1.27-alpine

# Avoid Docker prepopulating a named volume at /etc/nginx/conf.d with this stub (breaks API proxy bootstrap).
RUN rm -f /etc/nginx/conf.d/default.conf

RUN apk add --no-cache python3 wget

COPY nginx.conf /etc/nginx/nginx.conf
COPY default.conf.bootstrap /docker/default.conf.bootstrap
COPY reload_server.py /reload_server.py
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh /reload_server.py

EXPOSE 80 443 8099

HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=5 \
  CMD wget -qO- http://127.0.0.1/health >/dev/null || exit 1

ENTRYPOINT ["/entrypoint.sh"]
