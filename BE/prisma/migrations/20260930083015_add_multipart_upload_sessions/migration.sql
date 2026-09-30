-- CreateEnum
CREATE TYPE "MultipartUploadStatus" AS ENUM ('ACTIVE', 'COMPLETED', 'ABORTED');

-- CreateTable
CREATE TABLE "MultipartUploadSession" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "uploadId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "fileType" TEXT NOT NULL,
    "fileSize" BIGINT NOT NULL,
    "status" "MultipartUploadStatus" NOT NULL DEFAULT 'ACTIVE',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),
    "abortedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MultipartUploadSession_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MultipartUploadSession_uploadId_key" ON "MultipartUploadSession"("uploadId");

-- CreateIndex
CREATE UNIQUE INDEX "MultipartUploadSession_key_key" ON "MultipartUploadSession"("key");

-- CreateIndex
CREATE INDEX "MultipartUploadSession_userId_status_idx" ON "MultipartUploadSession"("userId", "status");

-- CreateIndex
CREATE INDEX "MultipartUploadSession_status_expiresAt_idx" ON "MultipartUploadSession"("status", "expiresAt");

-- AddForeignKey
ALTER TABLE "MultipartUploadSession" ADD CONSTRAINT "MultipartUploadSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
