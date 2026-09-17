process.env.NODE_ENV ??= 'test';

// Required by src/app.ts env validation and JWT middleware.
process.env.JWT_SECRET ??= 'test-secret';

// Allow app/media routes to build signed URLs without real credentials in tests.
process.env.CLOUDINARY_CLOUD_NAME ??= 'test-cloud';
process.env.CLOUDINARY_API_KEY ??= 'test-key';
process.env.CLOUDINARY_API_SECRET ??= 'test-secret';

process.env.CLIENT_URL ??= 'http://localhost:5173';
process.env.CLIENT_ORIGIN ??= process.env.CLIENT_URL;