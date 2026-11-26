/**
 * True when a query has finished without usable data: it errored with nothing
 * cached, or the offline layer answered with `null`. Pages should then render
 * `DataUnavailable` instead of treating the missing data as empty/zero.
 * A disabled or still-loading query is never "unavailable".
 */
export function isQueryUnavailable(query) {
  return query.data == null && !query.isLoading && (query.isError || query.isFetched);
}
