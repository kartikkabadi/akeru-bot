import { describe, expect, it } from "vite-plus/test";

import { AVATAR_UPLOAD_MAX_FILE_BYTES, exceedsAvatarUploadLimit } from "./avatarUpload";

describe("avatar uploads", () => {
  it("accepts the limit and rejects larger files", () => {
    expect(exceedsAvatarUploadLimit({ size: AVATAR_UPLOAD_MAX_FILE_BYTES })).toBe(false);
    expect(exceedsAvatarUploadLimit({ size: AVATAR_UPLOAD_MAX_FILE_BYTES + 1 })).toBe(true);
  });
});
