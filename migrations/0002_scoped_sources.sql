-- Additive source identity. Legacy cards/settings and their existing IDs survive.
-- Apply once through D1's forward migration journal before the new Worker.
ALTER TABLE cards ADD COLUMN source_resource TEXT;
ALTER TABLE cards ADD COLUMN source_configuration INTEGER;
DROP INDEX source_unique;
CREATE UNIQUE INDEX legacy_source_unique ON cards(provider,item_id)
 WHERE provider IS NOT NULL AND source_resource IS NULL AND source_configuration IS NULL;
CREATE UNIQUE INDEX scoped_source_unique ON cards(provider,source_resource,source_configuration,item_id)
 WHERE provider IS NOT NULL AND source_resource IS NOT NULL AND source_configuration IS NOT NULL;
