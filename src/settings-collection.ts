// Shared exact-byte compare-and-swap for independently owned settings rows.
// A missing row participates in the same comparison as an existing row.
export function replaceCollectionSetting(db:D1Database,key:'config'|'profile-achievements-v1'|'profile-tags-v1',raw:string|null,bytes:string){
 return db.prepare('INSERT INTO settings(id,value) SELECT ?1,?2 WHERE (?3 IS NULL AND NOT EXISTS(SELECT 1 FROM settings WHERE id=?1)) OR EXISTS(SELECT 1 FROM settings WHERE id=?1 AND value=?3) ON CONFLICT(id) DO UPDATE SET value=excluded.value WHERE settings.value=?3 RETURNING value').bind(key,bytes,raw).first<{value:string}>();
}
