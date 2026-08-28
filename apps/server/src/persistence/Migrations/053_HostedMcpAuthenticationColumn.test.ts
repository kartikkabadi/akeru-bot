import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { runMigrations } from "../Migrations.ts";
import * as NodeSqliteClient from "../NodeSqliteClient.ts";

const memoryLayer = () => it.layer(Layer.mergeAll(NodeSqliteClient.layerMemory()));

const columnNames = (columns: ReadonlyArray<{ readonly name: string }>) =>
  columns.map((column) => column.name);

memoryLayer()("053_HostedMcpAuthenticationColumn", (it) => {
  it.effect("is a no-op when slot 52 already added the column", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;

      yield* runMigrations({ toMigrationInclusive: 52 });
      yield* runMigrations({ toMigrationInclusive: 53 });

      const columns = yield* sql<{ readonly name: string }>`
        PRAGMA table_info(projection_mcp_servers)
      `;
      assert.ok(columnNames(columns).includes("authentication"));
    }),
  );
});

memoryLayer()("053_HostedMcpAuthenticationColumn collision", (it) => {
  it.effect("adds the column when slot 52 was claimed by ExecutorPluginCommand", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;

      yield* runMigrations({ toMigrationInclusive: 51 });
      yield* sql`
        INSERT INTO effect_sql_migrations (migration_id, name)
        VALUES (52, 'ExecutorPluginCommand')
      `;

      const columnsBefore = yield* sql<{ readonly name: string }>`
        PRAGMA table_info(projection_mcp_servers)
      `;
      assert.ok(!columnNames(columnsBefore).includes("authentication"));

      yield* sql`
        INSERT INTO projection_mcp_servers (
          mcp_server_id, name, transport, command, args_json, url, enabled, created_at, updated_at
        ) VALUES (
          'builtin-executor', 'Executor', 'stdio', 'executor.sh', NULL, NULL, 1,
          '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'
        )
      `;

      yield* runMigrations();

      const columns = yield* sql<{ readonly name: string }>`
        PRAGMA table_info(projection_mcp_servers)
      `;
      assert.ok(columnNames(columns).includes("authentication"));

      const executor = yield* sql<{
        readonly transport: string;
        readonly command: string | null;
        readonly argsJson: string | null;
        readonly url: string;
        readonly authentication: string;
      }>`
        SELECT transport, command, args_json AS "argsJson", url, authentication
        FROM projection_mcp_servers
        WHERE mcp_server_id = 'builtin-executor'
      `;
      assert.deepEqual(executor, [
        {
          transport: "url",
          command: null,
          argsJson: null,
          url: "https://executor.sh/mcp",
          authentication: "oauth",
        },
      ]);
    }),
  );
});
