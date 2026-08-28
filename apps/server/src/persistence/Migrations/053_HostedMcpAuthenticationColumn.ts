import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

// Slot 52 was reused on long-lived databases (ExecutorPluginCommand). Effect
// records migrations by id, so HostedMcpAuthentication never ran there.
// Re-apply the authentication column under a free slot.
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const columns = yield* sql<{ readonly name: string }>`
    PRAGMA table_info(projection_mcp_servers)
  `;

  if (!columns.some((column) => column.name === "authentication")) {
    yield* sql`
      ALTER TABLE projection_mcp_servers
      ADD COLUMN authentication TEXT
    `;
  }

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
