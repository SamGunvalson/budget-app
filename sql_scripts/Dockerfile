FROM postgres:16-alpine

ENV SQL_DIR=/sql_scripts
COPY *.sql /sql_scripts/
COPY local/ /sql_scripts/local/
COPY local/init.sh /docker-entrypoint-initdb.d/00-budget.sh
RUN chmod 755 /docker-entrypoint-initdb.d/00-budget.sh
