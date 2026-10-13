import "dotenv/config";
import {
    HeadObjectCommand,
    ListObjectsV2Command,
} from "@aws-sdk/client-s3";
import {
    getR2Client,
    getR2BucketName,
} from "../src/config/r2.js";

const originalKey =
    "vault/users/cmv0siyhg000001l4quflgs1u/4b194175-8c2e-4af9-9f5c-51bf04f4648c";

const variantsPrefix =
    "vault/users/cmv0siyhg000001l4quflgs1u/.variants/cmv6jbsaf000a01qi0keecv74/";

async function main() {
    const client = getR2Client();
    const bucket = getR2BucketName();

    try {
        await client.send(
            new HeadObjectCommand({ Bucket: bucket, Key: originalKey }),
        );
        console.log("Original object: EXISTS");
    } catch (error: any) {
        if (
            error?.$metadata?.httpStatusCode === 404 ||
            error?.name === "NotFound" ||
            error?.name === "NoSuchKey"
        ) {
            console.log("Original object: NOT FOUND");
        } else {
            console.log("Original object check error:", error?.name ?? error);
        }
    }

    try {
        const result = await client.send(
            new ListObjectsV2Command({
                Bucket: bucket,
                Prefix: variantsPrefix,
                MaxKeys: 1000,
            }),
        );

        const keys = result.Contents ?? [];
        console.log("Variant objects found:", keys.length);

        for (const object of keys) {
            console.log("Variant:", object.Key);
        }

        if (result.IsTruncated) {
            console.log("Listing truncated; additional read-only checks are needed.");
        }
    } catch (error: any) {
        console.log("Variant listing error:", error?.name ?? error);
    }
}

main().catch((error) => {
    console.error("R2 verification failed:");

    if (error instanceof Error) {
        console.error("Name:", error.name);
        console.error("Message:", error.message);

        if ("$metadata" in error) {
            console.error(
                "HTTP status:",
                (error as { $metadata?: { httpStatusCode?: number } }).$metadata
                    ?.httpStatusCode
            );
        }
    } else {
        console.error(String(error));
    }

    process.exitCode = 1;
});
