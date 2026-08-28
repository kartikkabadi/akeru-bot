import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    UPDATE orchestration_events
    SET payload_json = json_set(payload_json, '$.sandbox', 'local')
    WHERE event_type IN ('bot.created', 'bot.updated')
      AND json_extract(payload_json, '$.sandbox') = 'akeru-cloud'
  `;

  yield* sql`
    UPDATE projection_bots
    SET sandbox = 'local'
    WHERE sandbox = 'akeru-cloud'
  `;
});
