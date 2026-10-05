ALTER TABLE "Media"
ADD COLUMN "multipartUploadId" TEXT;

CREATE UNIQUE INDEX "Media_multipartUploadId_key"
ON "Media"("multipartUploadId");
