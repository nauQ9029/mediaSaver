-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "MediaType" AS ENUM ('IMAGE', 'VIDEO');
CREATE TYPE "MediaStatus" AS ENUM ('PENDING', 'READY', 'FAILED');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL, "email" TEXT NOT NULL, "password" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "Media" (
    "id" TEXT NOT NULL, "ownerId" TEXT NOT NULL, "cloudinaryAssetId" TEXT NOT NULL,
    "publicId" TEXT NOT NULL, "secureUrl" TEXT, "originalFilename" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL, "mediaType" "MediaType" NOT NULL, "bytes" INTEGER NOT NULL,
    "width" INTEGER, "height" INTEGER, "duration" DOUBLE PRECISION, "takenAt" TIMESTAMP(3),
    "latitude" DOUBLE PRECISION, "longitude" DOUBLE PRECISION,
    "status" "MediaStatus" NOT NULL DEFAULT 'READY',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Media_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "Album" (
    "id" TEXT NOT NULL, "ownerId" TEXT NOT NULL, "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Album_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "Tag" (
    "id" TEXT NOT NULL, "ownerId" TEXT NOT NULL, "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Tag_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "MediaAlbum" (
    "mediaId" TEXT NOT NULL, "albumId" TEXT NOT NULL,
    "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MediaAlbum_pkey" PRIMARY KEY ("mediaId", "albumId")
);
CREATE TABLE "MediaTag" (
    "mediaId" TEXT NOT NULL, "tagId" TEXT NOT NULL,
    CONSTRAINT "MediaTag_pkey" PRIMARY KEY ("mediaId", "tagId")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");
CREATE UNIQUE INDEX "Media_cloudinaryAssetId_key" ON "Media"("cloudinaryAssetId");
CREATE UNIQUE INDEX "Media_publicId_key" ON "Media"("publicId");
CREATE INDEX "Media_ownerId_createdAt_id_idx" ON "Media"("ownerId", "createdAt", "id");
CREATE UNIQUE INDEX "Album_ownerId_name_key" ON "Album"("ownerId", "name");
CREATE UNIQUE INDEX "Tag_ownerId_name_key" ON "Tag"("ownerId", "name");
CREATE INDEX "MediaAlbum_albumId_addedAt_idx" ON "MediaAlbum"("albumId", "addedAt");
CREATE INDEX "MediaTag_tagId_idx" ON "MediaTag"("tagId");

-- AddForeignKey
ALTER TABLE "Media" ADD CONSTRAINT "Media_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Album" ADD CONSTRAINT "Album_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Tag" ADD CONSTRAINT "Tag_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MediaAlbum" ADD CONSTRAINT "MediaAlbum_mediaId_fkey" FOREIGN KEY ("mediaId") REFERENCES "Media"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MediaAlbum" ADD CONSTRAINT "MediaAlbum_albumId_fkey" FOREIGN KEY ("albumId") REFERENCES "Album"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MediaTag" ADD CONSTRAINT "MediaTag_mediaId_fkey" FOREIGN KEY ("mediaId") REFERENCES "Media"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MediaTag" ADD CONSTRAINT "MediaTag_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "Tag"("id") ON DELETE CASCADE ON UPDATE CASCADE;
