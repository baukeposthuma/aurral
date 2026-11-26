import type Database from "better-sqlite3";

export const MANAGE_DOWNLOADS_PERMISSION_MIGRATION_KEY = "migration:manage-downloads-permission-v1";

// Managing everyone's downloads used to come with accessPlaylists. Users and
// defaults that had it keep that power after the split, until an admin changes it.
export const splitManageDownloadsPermission = (db: Database.Database) =>
  db.transaction(() => {
    const claimed = db
      .prepare("INSERT OR IGNORE INTO settings (key, value) VALUES (?, '1')")
      .run(MANAGE_DOWNLOADS_PERMISSION_MIGRATION_KEY);
    if (claimed.changes === 0) return;
    copyStoredPermission(db);
  })();

function copyStoredPermission(db: Database.Database) {
  const hasPermissions = db
    .prepare("SELECT 1 FROM pragma_table_info('users') WHERE name = 'permissions'")
    .get();
  if (hasPermissions) {
    db.exec(`
      UPDATE users
      SET permissions = json_set(
        permissions,
        '$.manageDownloads',
        json(iif(json_extract(permissions, '$.accessPlaylists') = 1, 'true', 'false'))
      )
      WHERE json_valid(permissions)
        AND json_type(permissions, '$.accessPlaylists') IS NOT NULL
        AND json_type(permissions, '$.manageDownloads') IS NULL
    `);
  }
  db.exec(`
    UPDATE settings
    SET value = json_set(
      value,
      '$.defaultPermissions.manageDownloads',
      json(iif(json_extract(value, '$.defaultPermissions.accessPlaylists') = 1, 'true', 'false'))
    )
    WHERE key = 'security'
      AND json_valid(value)
      AND json_type(value, '$.defaultPermissions.accessPlaylists') IS NOT NULL
      AND json_type(value, '$.defaultPermissions.manageDownloads') IS NULL
  `);
}
