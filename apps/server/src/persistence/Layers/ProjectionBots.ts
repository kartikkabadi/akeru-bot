import { BotAvatar, BotEngine, BotUsageCap, McpServerId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as Struct from "effect/Struct";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as SqlSchema from "effect/unstable/sql/SqlSchema";

import { toPersistenceSqlError } from "../Errors.ts";
import {
  GetProjectionBotInput,
  ProjectionBot,
  ProjectionBotRepository,
  type ProjectionBotRepositoryShape,
} from "../Services/ProjectionBots.ts";

const ProjectionBotDbRow = ProjectionBot.mapFields(
  Struct.assign({
    avatar: Schema.fromJsonString(BotAvatar),
    engine: Schema.NullOr(Schema.fromJsonString(BotEngine)),
    usageCap: Schema.NullOr(Schema.fromJsonString(BotUsageCap)),
    disabledMcpServerIds: Schema.fromJsonString(Schema.Array(McpServerId)),
  }),
);

const makeProjectionBotRepository = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const upsertBotRow = SqlSchema.void({
    Request: ProjectionBot,
    execute: (row) => sql`
      INSERT INTO projection_bots (
        bot_id, name, title, label, description, disabled_mcp_server_ids_json,
        avatar_json, engine_json, sandbox, runtime_mode, usage_cap_json,
        group_id, archived_at, created_at, updated_at
      ) VALUES (
        ${row.botId}, ${row.name}, ${row.title}, ${row.label}, ${row.description},
        ${JSON.stringify(row.disabledMcpServerIds)}, ${JSON.stringify(row.avatar)},
        ${row.engine === null ? null : JSON.stringify(row.engine)}, ${row.sandbox},
        ${row.runtimeMode}, ${row.usageCap === null ? null : JSON.stringify(row.usageCap)},
        ${row.groupId}, ${row.archivedAt}, ${row.createdAt}, ${row.updatedAt}
      )
      ON CONFLICT (bot_id) DO UPDATE SET
        name = excluded.name,
        title = excluded.title,
        label = excluded.label,
        description = excluded.description,
        disabled_mcp_server_ids_json = excluded.disabled_mcp_server_ids_json,
        avatar_json = excluded.avatar_json,
        engine_json = excluded.engine_json,
        sandbox = excluded.sandbox,
        runtime_mode = excluded.runtime_mode,
        usage_cap_json = excluded.usage_cap_json,
        group_id = excluded.group_id,
        archived_at = excluded.archived_at,
        created_at = excluded.created_at,
        updated_at = excluded.updated_at
    `,
  });

  const getBotRow = SqlSchema.findOneOption({
    Request: GetProjectionBotInput,
    Result: ProjectionBotDbRow,
    execute: ({ botId }) => sql`
      SELECT
        bot_id AS "botId", name, title, label, description,
        disabled_mcp_server_ids_json AS "disabledMcpServerIds", avatar_json AS "avatar",
        engine_json AS "engine", sandbox, runtime_mode AS "runtimeMode",
        usage_cap_json AS "usageCap", group_id AS "groupId", archived_at AS "archivedAt",
        created_at AS "createdAt", updated_at AS "updatedAt"
      FROM projection_bots
      WHERE bot_id = ${botId}
    `,
  });

  const listBotRows = SqlSchema.findAll({
    Request: Schema.Void,
    Result: ProjectionBotDbRow,
    execute: () => sql`
      SELECT
        bot_id AS "botId", name, title, label, description,
        disabled_mcp_server_ids_json AS "disabledMcpServerIds", avatar_json AS "avatar",
        engine_json AS "engine", sandbox, runtime_mode AS "runtimeMode",
        usage_cap_json AS "usageCap", group_id AS "groupId", archived_at AS "archivedAt",
        created_at AS "createdAt", updated_at AS "updatedAt"
      FROM projection_bots
      ORDER BY created_at ASC, bot_id ASC
    `,
  });

  const deleteBotRow = SqlSchema.void({
    Request: GetProjectionBotInput,
    execute: ({ botId }) => sql`DELETE FROM projection_bots WHERE bot_id = ${botId}`,
  });

  const upsert: ProjectionBotRepositoryShape["upsert"] = (row) =>
    upsertBotRow(row).pipe(
      Effect.mapError(toPersistenceSqlError("ProjectionBotRepository.upsert:query")),
    );
  const getById: ProjectionBotRepositoryShape["getById"] = (input) =>
    getBotRow(input).pipe(
      Effect.mapError(toPersistenceSqlError("ProjectionBotRepository.getById:query")),
    );
  const listAll: ProjectionBotRepositoryShape["listAll"] = () =>
    listBotRows(undefined).pipe(
      Effect.mapError(toPersistenceSqlError("ProjectionBotRepository.listAll:query")),
    );
  const deleteById: ProjectionBotRepositoryShape["deleteById"] = (input) =>
    deleteBotRow(input).pipe(
      Effect.mapError(toPersistenceSqlError("ProjectionBotRepository.deleteById:query")),
    );

  return { upsert, getById, listAll, deleteById } satisfies ProjectionBotRepositoryShape;
});

export const ProjectionBotRepositoryLive = Layer.effect(
  ProjectionBotRepository,
  makeProjectionBotRepository,
);
