import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    ALTER TABLE projection_mcp_servers
    ADD COLUMN authentication TEXT
  `;

  yield* sql`
    UPDATE projection_mcp_servers
    SET authentication = 'oauth'
    WHERE mcp_server_id IN (
      'builtin-context',
      'builtin-executor',
      'builtin-firecrawl',
      'builtin-parallel-search'
    )
  `;

  yield* sql`
    UPDATE projection_mcp_servers
    SET authentication = 'optional-oauth'
    WHERE mcp_server_id = 'builtin-exa'
  `;

  yield* sql`
    UPDATE projection_mcp_servers
    SET
      transport = 'url',
      command = NULL,
      args_json = NULL,
      url = 'https://executor.sh/mcp',
      authentication = 'oauth'
    WHERE mcp_server_id = 'builtin-executor'
  `;
});
