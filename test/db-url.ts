// Matches the credentials/port in test/docker-compose.yml.
// No `ssl` query param: pg-connection-string treats `ssl=false` as the
// literal string "false", which is truthy and triggers SSL negotiation
// anyway. Omitting the param entirely is what actually disables SSL.
export const TEST_DATABASE_URL =
  "redshift://redshift:redshift@localhost:5439/analytics";
