import { GetObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import sharp from 'sharp';
import exifr from 'exifr';
import { prisma } from '../lib/prisma.js';
import { getR2BucketName, getR2Client } from '../config/r2.js';

const MAX_IMAGE_METADATA_BYTES = 32 * 1024 * 1024;

export class PermanentMediaMetadataError extends Error {
  readonly permanent = true;
}

export async function processMediaMetadata(mediaId: string, ownerId: string, publicId: string) {
  const media = await prisma.media.findFirst({
    where: { id: mediaId, ownerId, publicId, storageProvider: 'R2' },
  });
  if (!media) throw new PermanentMediaMetadataError('Media record no longer matches the processing job');
  if (media.status === 'READY') return;
  if (media.status !== 'PENDING') throw new PermanentMediaMetadataError(`Media cannot be processed from ${media.status}`);
  const objectKey = media.publicId;
  if (!objectKey) throw new PermanentMediaMetadataError('Media storage reference is missing');

  let metadata: {
    width?: number;
    height?: number;
    takenAt?: Date;
    latitude?: number;
    longitude?: number;
  } = {};
  if (media.mediaType === 'IMAGE') {
    const client = getR2Client();
    const bucket = getR2BucketName();
    const head = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: objectKey }));
    if (!Number.isSafeInteger(head.ContentLength) || !head.ContentLength || head.ContentLength > MAX_IMAGE_METADATA_BYTES) {
      throw new PermanentMediaMetadataError('Image exceeds the metadata processing size limit');
    }

    const object = await client.send(new GetObjectCommand({ Bucket: bucket, Key: objectKey }));
    if (!object.Body) throw new PermanentMediaMetadataError('Image object has no body');
    const bytes = Buffer.from(await object.Body.transformToByteArray());
    try {
      const extracted = await sharp(bytes, { limitInputPixels: 100_000_000 }).metadata();
      metadata = {
        ...(Number.isSafeInteger(extracted.width) ? { width: extracted.width } : {}),
        ...(Number.isSafeInteger(extracted.height) ? { height: extracted.height } : {}),
      };
      try {
        const exif = await exifr.parse(bytes, ['DateTimeOriginal', 'CreateDate', 'latitude', 'longitude']);
        const captureTime = exif?.DateTimeOriginal ?? exif?.CreateDate;
        if (captureTime instanceof Date && !Number.isNaN(captureTime.getTime())) {
          metadata.takenAt = captureTime;
        }
        if (Number.isFinite(exif?.latitude) && Number.isFinite(exif?.longitude)) {
          metadata.latitude = exif.latitude;
          metadata.longitude = exif.longitude;
        }
      } catch (error) {
        console.warn('Could not parse optional image EXIF metadata', {
          mediaId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    } catch (error) {
      throw new PermanentMediaMetadataError(`Image metadata could not be read: ${(error as Error).message}`);
    }
  }

  await prisma.media.updateMany({
    where: { id: media.id, ownerId, publicId, status: 'PENDING' },
    data: { ...metadata, status: 'READY' },
  });
}
