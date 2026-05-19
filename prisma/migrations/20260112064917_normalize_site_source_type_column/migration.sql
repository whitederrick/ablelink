DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name='sites'
      AND column_name='siteSourceTyp'
  ) THEN
    ALTER TABLE "sites" RENAME COLUMN "siteSourceTyp" TO "siteSourceType";
  END IF;
END $$;
