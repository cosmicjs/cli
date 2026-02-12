/**
 * Image handling utilities for the chat module
 * Handles Unsplash image uploads, URL extraction, and metafield image processing
 */

import chalk from 'chalk';
import { uploadMedia } from '../api/dashboard.js';
import * as spinner from '../utils/spinner.js';
import { getRandomFallbackImage } from './utils.js';

/**
 * Upload an image from URL (Unsplash) to Cosmic media library
 * Uses Dashboard API (Workers) for parity with the dashboard
 */
export async function uploadUnsplashImage(
  imageUrl: string,
  bucketSlug: string
): Promise<string | null> {
  try {
    // Fetch the image
    const response = await fetch(imageUrl);
    if (!response.ok) {
      console.log(chalk.dim(`  Failed to fetch image: ${imageUrl}`));
      return null;
    }

    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // Generate filename from URL
    const urlObj = new URL(imageUrl);
    const pathParts = urlObj.pathname.split('/');
    const filenameBase = pathParts[pathParts.length - 1] || `image-${Date.now()}`;
    const filename = `${filenameBase}-${Date.now()}.jpg`;

    // Upload to Cosmic via Dashboard API (like the dashboard does)
    const media = await uploadMedia(bucketSlug, {
      buffer,
      filename,
      contentType: 'image/jpeg',
    });
    return media.name || null;
  } catch (error) {
    console.log(chalk.dim(`  Error uploading image: ${(error as Error).message}`));
    return null;
  }
}

/**
 * Extract image URL from metafield value (handles various formats)
 */
export function extractImageUrl(value: unknown): string | null {
  if (!value) return null;

  // Direct URL string
  if (typeof value === 'string') {
    if (value.includes('images.unsplash.com') ||
      value.includes('imgix.cosmicjs.com') ||
      value.includes('cdn.cosmicjs.com')) {
      return value;
    }
    return null;
  }

  // Object with url or imgix_url property (e.g. {url, imgix_url} from Cosmic API)
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const url = obj.url || obj.imgix_url;
    if (typeof url === 'string') {
      return url;
    }
  }

  return null;
}

/**
 * Get the URL to fetch for upload - extracts inner Unsplash URL from cdn.cosmicjs.com wrapper
 */
export function getUploadUrl(imageUrl: string): string {
  // cdn.cosmicjs.com wraps URLs: https://cdn.cosmicjs.com/https://images.unsplash.com/...
  const cdnMatch = imageUrl.match(/https:\/\/cdn\.cosmicjs\.com\/(https:\/\/images\.unsplash\.com\/.+)/);
  if (cdnMatch) {
    return cdnMatch[1];
  }
  return imageUrl;
}

/**
 * Process metafield values and upload any images to Cosmic
 */
export async function processMetafieldImages(
  metafields: Record<string, unknown>[],
  bucketSlug: string
): Promise<Record<string, unknown>[]> {

  const processedMetafields = [];

  for (const mf of metafields) {
    const metafield = { ...mf };
    const fieldType = metafield.type as string;
    const fieldKey = metafield.key as string;

    // Handle 'file' type metafields (single image)
    if (fieldType === 'file' ||
      fieldKey?.includes('image') ||
      fieldKey?.includes('photo') ||
      fieldKey?.includes('thumbnail') ||
      fieldKey?.includes('featured')) {
      const imageUrl = extractImageUrl(metafield.value);

      if (imageUrl) {
        // Check if it's an external URL that needs uploading
        if (imageUrl.includes('images.unsplash.com')) {
          spinner.update(`Uploading image for "${fieldKey}"...`);
          const uploadedName = await uploadUnsplashImage(imageUrl, bucketSlug);
          if (uploadedName) {
            metafield.value = uploadedName;
          } else {
            // Use fallback image when upload fails (like Dashboard does)
            const fallbackUrl = getRandomFallbackImage();
            metafield.value = fallbackUrl.replace('https://imgix.cosmicjs.com/', '');
          }
        } else if (imageUrl.includes('imgix.cosmicjs.com')) {
          // Extract just the filename from imgix URL
          metafield.value = imageUrl.replace('https://imgix.cosmicjs.com/', '');
        } else if (imageUrl.includes('cdn.cosmicjs.com')) {
          // Handle cdn URLs - they might have double URLs
          // e.g., "https://cdn.cosmicjs.com/https://images.unsplash.com/..."
          const match = imageUrl.match(/https:\/\/cdn\.cosmicjs\.com\/(.+)/);
          if (match) {
            const innerUrl = match[1];
            if (innerUrl.startsWith('https://images.unsplash.com')) {
              spinner.update(`Uploading image for "${fieldKey}"...`);
              const uploadedName = await uploadUnsplashImage(innerUrl, bucketSlug);
              if (uploadedName) {
                metafield.value = uploadedName;
              } else {
                // Use fallback image when upload fails
                const fallbackUrl = getRandomFallbackImage();
                metafield.value = fallbackUrl.replace('https://imgix.cosmicjs.com/', '');
              }
            } else {
              metafield.value = innerUrl;
            }
          }
        }
      }
    }

    // Handle 'files' type metafields (multiple images)
    else if (fieldType === 'files' && Array.isArray(metafield.value)) {
      const processedValues: string[] = [];

      if (process.env.COSMIC_DEBUG) {
        console.log(`[DEBUG] Processing files type metafield "${fieldKey}" with ${(metafield.value as unknown[]).length} items`);
      }

      for (const item of metafield.value as unknown[]) {
        const imageUrl = extractImageUrl(item);

        if (imageUrl) {
          const needsUpload = imageUrl.includes('images.unsplash.com') || imageUrl.includes('cdn.cosmicjs.com');

          if (process.env.COSMIC_DEBUG) {
            console.log(`[DEBUG]   Item URL: ${imageUrl}, needsUpload: ${needsUpload}`);
          }

          if (needsUpload) {
            const uploadUrl = getUploadUrl(imageUrl);

            if (process.env.COSMIC_DEBUG) {
              console.log(`[DEBUG]   Upload URL (after unwrap): ${uploadUrl}`);
            }

            spinner.update(`Uploading image for "${fieldKey}"...`);
            const uploadedName = await uploadUnsplashImage(uploadUrl, bucketSlug);

            if (process.env.COSMIC_DEBUG) {
              console.log(`[DEBUG]   Uploaded as: ${uploadedName || 'FAILED'}`);
            }

            if (uploadedName) {
              processedValues.push(uploadedName);
            } else {
              // Use fallback image when upload fails
              const fallbackUrl = getRandomFallbackImage();
              processedValues.push(fallbackUrl.replace('https://imgix.cosmicjs.com/', ''));
            }
          } else if (imageUrl.includes('imgix.cosmicjs.com')) {
            processedValues.push(imageUrl.replace('https://imgix.cosmicjs.com/', ''));
          } else if (imageUrl.includes('cdn.cosmicjs.com')) {
            const match = imageUrl.match(/https:\/\/cdn\.cosmicjs\.com\/(.+)/);
            processedValues.push(match ? match[1] : imageUrl);
          } else {
            processedValues.push(typeof item === 'string' ? item : imageUrl);
          }
        } else if (typeof item === 'string') {
          processedValues.push(item);
        }
      }

      metafield.value = processedValues;
    }

    processedMetafields.push(metafield);
  }

  return processedMetafields;
}

/**
 * Process Unsplash URLs in an object's metadata and thumbnail
 */
export async function processUnsplashUrls(
  obj: Record<string, unknown>,
  bucketSlug: string,
  objectTypeMetafields: Record<string, unknown>[]
): Promise<void> {
  // Process thumbnail
  if (typeof obj.thumbnail === 'string' && obj.thumbnail.includes('images.unsplash.com')) {
    console.log(chalk.dim(`  Uploading thumbnail image...`));
    const mediaName = await uploadUnsplashImage(obj.thumbnail, bucketSlug);
    if (mediaName) {
      obj.thumbnail = mediaName;
    } else {
      // Use fallback
      const fallback = getRandomFallbackImage();
      obj.thumbnail = fallback.replace('https://imgix.cosmicjs.com/', '');
    }
  }

  // Process metadata
  if (obj.metadata && typeof obj.metadata === 'object') {
    const metadata = obj.metadata as Record<string, unknown>;

    for (const [key, value] of Object.entries(metadata)) {
      // Find the metafield definition to check type
      const metafieldDef = objectTypeMetafields.find((m) => m.key === key);

      // Handle file type with Unsplash URL
      if (
        metafieldDef?.type === 'file' &&
        typeof value === 'string' &&
        value.includes('images.unsplash.com')
      ) {
        console.log(chalk.dim(`  Uploading ${key} image...`));
        const mediaName = await uploadUnsplashImage(value, bucketSlug);
        if (mediaName) {
          metadata[key] = mediaName;
        } else {
          const fallback = getRandomFallbackImage();
          metadata[key] = fallback.replace('https://imgix.cosmicjs.com/', '');
        }
      }

      // Handle files type (array) - supports both string URLs and {url, imgix_url} objects
      const isFilesType = metafieldDef?.type === 'files' ||
        (['photos', 'images', 'gallery'].includes(key) && Array.isArray(value));
      if (isFilesType && Array.isArray(value)) {
        const processedFiles: string[] = [];
        for (const item of value) {
          const imageUrl = extractImageUrl(item);
          if (imageUrl) {
            const needsUpload = imageUrl.includes('images.unsplash.com') ||
              imageUrl.includes('cdn.cosmicjs.com');
            if (needsUpload) {
              const uploadUrl = getUploadUrl(imageUrl);
              console.log(chalk.dim(`  Uploading ${key} image...`));
              const mediaName = await uploadUnsplashImage(uploadUrl, bucketSlug);
              if (mediaName) {
                processedFiles.push(mediaName);
              } else {
                const fallback = getRandomFallbackImage();
                processedFiles.push(fallback.replace('https://imgix.cosmicjs.com/', ''));
              }
            } else if (imageUrl.includes('imgix.cosmicjs.com')) {
              processedFiles.push(imageUrl.replace('https://imgix.cosmicjs.com/', ''));
            } else if (imageUrl.includes('cdn.cosmicjs.com')) {
              const match = imageUrl.match(/https:\/\/cdn\.cosmicjs\.com\/(.+)/);
              processedFiles.push(match ? match[1] : imageUrl);
            } else {
              processedFiles.push(typeof item === 'string' ? item : imageUrl);
            }
          } else if (typeof item === 'string') {
            processedFiles.push(item);
          }
        }
        metadata[key] = processedFiles;
      }
    }
  }
}
