/**
 * Content installation: install object types and demo objects to Cosmic
 * Also handles updating object references (slug -> ID resolution)
 */

import chalk from 'chalk';
import { getCurrentBucketSlug } from '../config/store.js';
import {
  createObjectType,
  createObjectWithMetafields,
  updateObjectWithMetafields,
  getObjectTypesWithMetafields,
  searchObjects,
} from '../api/dashboard.js';
import * as spinner from '../utils/spinner.js';
import { select } from '../utils/prompts.js';
import type { ExtractedContent } from './types.js';
import { addIdsToMetafields, createSlug, getRandomFallbackImage } from './utils.js';
import { uploadUnsplashImage, processMetafieldImages } from './images.js';

/**
 * Install content (object types and demo objects) to Cosmic
 */
export async function installContentToCosmic(
  extractedContent: ExtractedContent,
  rl: import('readline').Interface
): Promise<{ added: boolean; nextAction: 'build' | 'content' | 'exit' | null }> {

  const { objectTypes, demoObjects } = extractedContent;
  const totalTypes = objectTypes.length;
  const totalObjects = demoObjects.length;

  if (totalTypes === 0 && totalObjects === 0) {
    return { added: false, nextAction: null };
  }

  console.log();
  console.log(chalk.cyan('  📦 Content detected in AI response:'));
  if (totalTypes > 0) {
    console.log(chalk.dim(`     ${totalTypes} object type${totalTypes !== 1 ? 's' : ''}`));
    for (const type of objectTypes) {
      console.log(chalk.dim(`       • ${(type as { title?: string }).title || (type as { slug?: string }).slug || 'Unnamed'}`));
    }
  }
  if (totalObjects > 0) {
    console.log(chalk.dim(`     ${totalObjects} content object${totalObjects !== 1 ? 's' : ''}`));
    for (const obj of demoObjects) {
      console.log(chalk.dim(`       • ${(obj as { title?: string }).title || 'Unnamed'}`));
    }
  }
  console.log();

  // Prompt user (default to yes on Enter)
  const answer = await new Promise<string>((resolve) => {
    rl.question(chalk.yellow('  Would you like to add this content to Cosmic? (Y/n) '), resolve);
  });

  if (answer.toLowerCase() === 'n' || answer.toLowerCase() === 'no') {
    console.log(chalk.dim('  Skipped content installation.'));
    return { added: false, nextAction: null };
  }

  console.log();
  spinner.start('Adding content to Cosmic...');

  // Get bucket slug for DAPI calls
  const bucketSlug = getCurrentBucketSlug();
  if (!bucketSlug) {
    console.log(chalk.red('  ✗ No bucket selected'));
    return { added: false, nextAction: null };
  }

  try {
    // Add object types first using DAPI (like the dashboard does)
    let typesAdded = 0;
    let typesSkipped = 0;
    const typeErrors: string[] = [];

    for (const type of objectTypes) {
      try {
        // Add IDs to metafields
        const typeWithIds = { ...type } as Record<string, unknown>;
        if (Array.isArray(typeWithIds.metafields)) {
          typeWithIds.metafields = addIdsToMetafields(
            typeWithIds.metafields as Record<string, unknown>[]
          );
        }

        spinner.update(`Adding object type "${(type as { title?: string }).title}"...`);

        // Use DAPI endpoint like the dashboard
        await createObjectType(bucketSlug, typeWithIds as Parameters<typeof createObjectType>[1]);
        typesAdded++;
      } catch (err) {
        const errorMsg = (err as Error).message;
        // Check if type already exists
        if (errorMsg.includes('already exists') || errorMsg.includes('duplicate') || errorMsg.includes('Object Type slug is already used')) {
          typesSkipped++;
        } else {
          typeErrors.push(`${(type as { title?: string }).title || 'unknown'}: ${errorMsg}`);
        }
      }
    }

    // Build a map of object type metafields for enriching demo objects
    const objectTypeMetafieldsMap: Map<string, Map<string, Record<string, unknown>>> = new Map();

    // Fetch existing object types from the bucket (like the Dashboard does)
    try {
      spinner.update('Loading object types from bucket...');
      const existingTypes = await getObjectTypesWithMetafields(bucketSlug);
      for (const type of existingTypes) {
        if (type.slug && Array.isArray(type.metafields)) {
          const metafieldMap = new Map<string, Record<string, unknown>>();
          for (const mf of type.metafields as Record<string, unknown>[]) {
            if (mf.key) {
              metafieldMap.set(mf.key as string, mf);
            }
          }
          objectTypeMetafieldsMap.set(type.slug, metafieldMap);
        }
      }
    } catch (err) {
      // Continue with just the new object types if fetching fails
    }

    // Also add the newly created object types to the map
    for (const type of objectTypes) {
      const typeData = type as { slug?: string; metafields?: Record<string, unknown>[] };
      if (typeData.slug && Array.isArray(typeData.metafields)) {
        const metafieldMap = new Map<string, Record<string, unknown>>();
        for (const mf of typeData.metafields) {
          if (mf.key) {
            metafieldMap.set(mf.key as string, mf);
          }
        }
        objectTypeMetafieldsMap.set(typeData.slug, metafieldMap);
      }
    }

    // Add demo objects using DAPI (like the dashboard does)
    let objectsAdded = 0;
    let objectsSkipped = 0;
    const objectErrors: string[] = [];

    // Track successful installs for object reference resolution
    const successfulInstalls: Array<{
      object: Record<string, unknown>;
      id: string;
      insertPayload: Record<string, unknown>;
    }> = [];

    for (const obj of demoObjects) {
      try {
        const objTyped = obj as {
          title?: string;
          slug?: string;
          type?: string;
          content?: string;
          status?: string;
          thumbnail?: string;
          locale?: string;
          metafields?: Record<string, unknown>[];
          metadata?: Record<string, unknown>;
        };

        // Format object for DAPI (matching dashboard format)
        const insertPayload: {
          title: string;
          slug: string;
          type: string;
          content?: string;
          status?: string;
          thumbnail?: string;
          locale?: string;
          metafields?: Array<{
            id?: string;
            title?: string;
            key: string;
            type: string;
            value?: unknown;
            required?: boolean;
            options?: Array<{ key?: string; value: string }> | unknown;
            object_type?: string;
          }>;
        } = {
          title: objTyped.title || 'Untitled',
          slug: objTyped.slug || createSlug(objTyped.title || 'untitled'),
          type: objTyped.type || 'objects',
          content: objTyped.content || '',
          status: objTyped.status || 'published',
          locale: objTyped.locale || '',
        };

        if (objTyped.thumbnail) {
          // Handle Unsplash URLs
          if (objTyped.thumbnail.includes('images.unsplash.com')) {
            spinner.update(`Uploading image for "${objTyped.title}"...`);
            const uploaded = await uploadUnsplashImage(objTyped.thumbnail, bucketSlug);
            if (uploaded) {
              insertPayload.thumbnail = uploaded;
            } else {
              const fallbackUrl = getRandomFallbackImage();
              insertPayload.thumbnail = fallbackUrl.replace('https://imgix.cosmicjs.com/', '');
            }
          } else if (objTyped.thumbnail.includes('imgix.cosmicjs.com')) {
            insertPayload.thumbnail = objTyped.thumbnail.replace('https://imgix.cosmicjs.com/', '');
          } else {
            insertPayload.thumbnail = objTyped.thumbnail;
          }
        }

        if (Array.isArray(objTyped.metafields)) {
          // Add IDs to metafields
          const metafieldsWithIds = addIdsToMetafields(objTyped.metafields);

          // Process metafield images (upload Unsplash/external images to Cosmic)
          const processedMetafields = await processMetafieldImages(metafieldsWithIds, bucketSlug);

          // Get the object type metafields map for this object's type
          const typeMetafields = objectTypeMetafieldsMap.get(objTyped.type || '');

          // Format for API and copy options/object_type from object type
          insertPayload.metafields = processedMetafields.map(mf => {
            const metafield = mf as Record<string, unknown>;
            const key = metafield.key as string;
            const type = metafield.type as string;

            const formattedMetafield: Record<string, unknown> = {
              id: metafield.id as string,
              title: metafield.title as string || key.charAt(0).toUpperCase() + key.slice(1).replace(/_/g, ' '),
              key,
              type,
              value: metafield.value,
              required: metafield.required as boolean,
            };

            // For select-dropdown and check-boxes, copy options from the object type metafield
            if ((type === 'select-dropdown' || type === 'check-boxes' || type === 'radio-buttons') && typeMetafields) {
              const objectTypeMetafield = typeMetafields.get(key);
              if (objectTypeMetafield?.options) {
                formattedMetafield.options = objectTypeMetafield.options;
              } else if (metafield.options) {
                formattedMetafield.options = metafield.options;
              }
            }

            // For object and objects type, copy object_type from the object type metafield
            if ((type === 'object' || type === 'objects') && typeMetafields) {
              const objectTypeMetafield = typeMetafields.get(key);
              if (objectTypeMetafield?.object_type) {
                formattedMetafield.object_type = objectTypeMetafield.object_type;
              } else if (metafield.object_type) {
                formattedMetafield.object_type = metafield.object_type;
              }
            }

            return formattedMetafield as {
              id?: string;
              title?: string;
              key: string;
              type: string;
              value?: unknown;
              required?: boolean;
              object_type?: string;
            };
          });
        } else if (objTyped.metadata && typeof objTyped.metadata === 'object') {
          // Handle metadata object format (convert to metafields array)
          const metafieldsFromMetadata: Record<string, unknown>[] = [];

          const typeMetafields = objectTypeMetafieldsMap.get(objTyped.type || '');

          if (process.env.COSMIC_DEBUG) {
            console.log(`\n[DEBUG] Processing metadata for object type "${objTyped.type}"`);
            console.log(`[DEBUG] Has type metafields map: ${!!typeMetafields}`);
            if (typeMetafields) {
              const keys = Array.from(typeMetafields.keys());
              console.log(`[DEBUG] Object type has ${keys.length} metafields: ${keys.join(', ')}`);
            }
          }

          for (const [key, value] of Object.entries(objTyped.metadata as Record<string, unknown>)) {
            let fieldType = 'text';
            let objectType: string | undefined;
            let options: unknown;

            // Check if the object type has a definition for this metafield
            if (typeMetafields) {
              const objectTypeMetafield = typeMetafields.get(key);
              if (objectTypeMetafield) {
                fieldType = objectTypeMetafield.type as string || 'text';
                if (fieldType === 'object' || fieldType === 'objects') {
                  objectType = objectTypeMetafield.object_type as string;

                  if (process.env.COSMIC_DEBUG) {
                    console.log(`[DEBUG] Field "${key}" is type "${fieldType}" referencing "${objectType}"`);
                  }
                }
                if (objectTypeMetafield.options) {
                  options = objectTypeMetafield.options;
                }
                if (process.env.COSMIC_DEBUG && (fieldType === 'file' || fieldType === 'files')) {
                  console.log(`[DEBUG] Field "${key}" is type "${fieldType}" (from object type definition)`);
                }
              } else if (process.env.COSMIC_DEBUG) {
                console.log(`[DEBUG] Field "${key}" not found in object type metafields, will use fallback type detection`);
              }
            }

            // Fall back to guessing type if not found in object type definition
            if (fieldType === 'text') {
              if (Array.isArray(value)) {
                if (key.includes('image') || key.includes('photo') || key.includes('gallery') || key.includes('pictures')) {
                  fieldType = 'files';

                  if (process.env.COSMIC_DEBUG) {
                    console.log(`[DEBUG] Field "${key}" detected as type "files" (array of images, ${(value as unknown[]).length} items)`);
                  }
                }
              } else if (key.includes('image') || key.includes('photo') || key.includes('thumbnail') || key.includes('featured')) {
                fieldType = 'file';
              } else if (key.includes('content') || key.includes('body') || key.includes('description')) {
                fieldType = 'html-textarea';
              } else if (key.includes('date')) {
                fieldType = 'date';
              } else if (typeof value === 'boolean') {
                fieldType = 'switch';
              }
            }

            const metafieldEntry: Record<string, unknown> = {
              key,
              type: fieldType,
              title: key.charAt(0).toUpperCase() + key.slice(1).replace(/_/g, ' '),
              value,
              required: false,
            };

            if (objectType) {
              metafieldEntry.object_type = objectType;
            }

            if (options) {
              metafieldEntry.options = options;
            }

            metafieldsFromMetadata.push(metafieldEntry);
          }

          // Add IDs and process images
          const metafieldsWithIds = addIdsToMetafields(metafieldsFromMetadata);
          const processedMetafields = await processMetafieldImages(metafieldsWithIds, bucketSlug);

          // Format for API
          insertPayload.metafields = processedMetafields.map(mf => {
            const metafield = mf as Record<string, unknown>;
            const formattedMf: Record<string, unknown> = {
              id: metafield.id as string,
              title: metafield.title as string || (metafield.key as string).charAt(0).toUpperCase() + (metafield.key as string).slice(1).replace(/_/g, ' '),
              key: metafield.key as string,
              type: metafield.type as string,
              value: metafield.value,
              required: metafield.required as boolean,
            };

            if (metafield.object_type) {
              formattedMf.object_type = metafield.object_type;
            }

            if (metafield.options) {
              formattedMf.options = metafield.options;
            }

            return formattedMf as {
              id?: string;
              title?: string;
              key: string;
              type: string;
              value?: unknown;
              required?: boolean;
            };
          });
        }

        spinner.update(`Adding "${objTyped.title}"...`);

        // Debug: Log metafields with object/objects type
        if (process.env.COSMIC_DEBUG) {
          const objectMetafields = insertPayload.metafields?.filter(
            mf => mf.type === 'object' || mf.type === 'objects'
          );
          if (objectMetafields && objectMetafields.length > 0) {
            console.log(`\n[DEBUG] Object "${objTyped.title}" has ${objectMetafields.length} reference metafield(s):`);
            for (const mf of objectMetafields) {
              console.log(`  - ${mf.key} (type: ${mf.type}, value: ${JSON.stringify(mf.value)})`);
            }
          }
        }

        // Use DAPI endpoint like the dashboard
        const createdObject = await createObjectWithMetafields(bucketSlug, insertPayload);
        objectsAdded++;

        // Track successful installs for object reference resolution
        successfulInstalls.push({
          object: insertPayload,
          id: createdObject.id,
          insertPayload,
        });
      } catch (err) {
        const errorMsg = (err as Error).message;
        if (errorMsg.includes('already exists') || errorMsg.includes('duplicate')) {
          objectsSkipped++;
        } else {
          objectErrors.push(`${(obj as { title?: string }).title || 'unknown'}: ${errorMsg}`);
        }
      }
    }

    // Update object references (convert slugs to object IDs)
    if (successfulInstalls.length > 0) {
      spinner.update('Updating object references...');

      if (process.env.COSMIC_DEBUG) {
        console.log(`\n[DEBUG] Starting object reference updates for ${successfulInstalls.length} objects`);
      }

      await updateObjectReferences(bucketSlug, successfulInstalls);
    }

    spinner.stop();

    // Show results
    if (typesAdded > 0 || objectsAdded > 0) {
      console.log(chalk.green(`  ✓ Added ${typesAdded} object type${typesAdded !== 1 ? 's' : ''} and ${objectsAdded} content object${objectsAdded !== 1 ? 's' : ''}`));
    }

    if (typesSkipped > 0 || objectsSkipped > 0) {
      console.log(chalk.dim(`  ℹ Skipped ${typesSkipped} existing type${typesSkipped !== 1 ? 's' : ''} and ${objectsSkipped} existing object${objectsSkipped !== 1 ? 's' : ''}`));
    }

    if (typeErrors.length > 0) {
      console.log(chalk.yellow(`  ⚠ Failed to add ${typeErrors.length} object type${typeErrors.length !== 1 ? 's' : ''}:`));
      for (const err of typeErrors) {
        console.log(chalk.dim(`     • ${err}`));
      }
    }

    if (objectErrors.length > 0) {
      console.log(chalk.yellow(`  ⚠ Failed to add ${objectErrors.length} content object${objectErrors.length !== 1 ? 's' : ''}:`));
      for (const err of objectErrors) {
        console.log(chalk.dim(`     • ${err}`));
      }
    }

    if (typesAdded === 0 && objectsAdded === 0 && typeErrors.length === 0 && objectErrors.length === 0) {
      console.log(chalk.dim('  ℹ All content already exists in Cosmic.'));
    }

    // Show next steps prompt if content was added
    if (typesAdded > 0 || objectsAdded > 0) {
      console.log();

      const nextAction = await select<'build' | 'content' | 'exit'>({
        message: 'What would you like to do next?',
        choices: [
          { name: 'build', message: 'Build and deploy an app' },
          { name: 'content', message: 'Add more content' },
          { name: 'exit', message: 'Exit' },
        ],
      });

      return { added: true, nextAction };
    }

    return { added: typesAdded > 0 || objectsAdded > 0, nextAction: null };
  } catch (err) {
    spinner.stop();
    console.log(chalk.red(`  ✗ Failed to add content: ${(err as Error).message}`));
    return { added: false, nextAction: null };
  }
}

/**
 * Update object references after creation (convert slugs to object IDs)
 */
export async function updateObjectReferences(
  bucketSlug: string,
  successfulInstalls: Array<{
    object: Record<string, unknown>;
    id: string;
    insertPayload: Record<string, unknown>;
  }>
): Promise<void> {
  try {
    // Create a map of slugs to object IDs for quick lookup
    const slugToIdMap: Record<string, string> = {};

    for (const { insertPayload, id } of successfulInstalls) {
      const slug = insertPayload.slug as string;
      if (slug) {
        slugToIdMap[slug] = id;
      }
    }

    if (process.env.COSMIC_DEBUG) {
      console.log('[DEBUG] Built slug-to-ID map:', JSON.stringify(slugToIdMap, null, 2));
    }

    // Cache for existing objects fetched by slug
    const slugCache: Record<string, string | null> = {};

    // Helper function to get an object ID from a slug
    const getObjectIdFromSlug = async (slug: string): Promise<string | null> => {
      if (slugToIdMap[slug]) {
        if (process.env.COSMIC_DEBUG) {
          console.log(`[DEBUG] Found slug "${slug}" in newly created objects: ${slugToIdMap[slug]}`);
        }
        return slugToIdMap[slug];
      }

      if (slugCache[slug] !== undefined) {
        if (process.env.COSMIC_DEBUG) {
          console.log(`[DEBUG] Found slug "${slug}" in cache: ${slugCache[slug]}`);
        }
        return slugCache[slug];
      }

      try {
        if (process.env.COSMIC_DEBUG) {
          console.log(`[DEBUG] Searching for object with slug: "${slug}"`);
        }

        const result = await searchObjects(bucketSlug, { slug }, { limit: 1 });

        if (result.objects && result.objects.length > 0) {
          const objectId = result.objects[0].id;
          slugCache[slug] = objectId;

          if (process.env.COSMIC_DEBUG) {
            console.log(`[DEBUG] Found object with slug "${slug}": ${objectId}`);
          }

          return objectId;
        } else {
          slugCache[slug] = null;

          if (process.env.COSMIC_DEBUG) {
            console.log(`[DEBUG] No object found with slug "${slug}"`);
          }

          return null;
        }
      } catch (error) {
        slugCache[slug] = null;

        if (process.env.COSMIC_DEBUG) {
          console.log(`[DEBUG] Error searching for slug "${slug}": ${(error as Error).message}`);
        }

        return null;
      }
    };

    // Now update each object with proper references
    for (const { insertPayload, id } of successfulInstalls) {
      const metafields = insertPayload.metafields as Array<{
        id?: string;
        title?: string;
        key: string;
        type: string;
        value?: unknown;
        required?: boolean;
        options?: unknown;
        object_type?: string;
      }> | undefined;

      if (!metafields || !Array.isArray(metafields)) {
        if (process.env.COSMIC_DEBUG) {
          console.log(`[DEBUG] Object ${id} has no metafields array, skipping`);
        }
        continue;
      }

      // Check if any metafields need reference resolution
      const needsUpdate = metafields.some(
        (metafield) =>
          (metafield.type === 'object' && typeof metafield.value === 'string') ||
          (metafield.type === 'objects' &&
            Array.isArray(metafield.value) &&
            (metafield.value as unknown[]).some((val) => typeof val === 'string'))
      );

      if (process.env.COSMIC_DEBUG) {
        const title = insertPayload.title;
        console.log(`\n[DEBUG] Checking object "${title}" (${id})`);
        console.log(`[DEBUG] Has ${metafields.length} metafields, needsUpdate: ${needsUpdate}`);

        const refMetafields = metafields.filter(mf => mf.type === 'object' || mf.type === 'objects');
        if (refMetafields.length > 0) {
          console.log('[DEBUG] Reference metafields:');
          for (const mf of refMetafields) {
            console.log(`  - ${mf.key}: type=${mf.type}, value=${JSON.stringify(mf.value)}`);
          }
        }
      }

      if (needsUpdate) {
        const updatedMetafields = metafields.map(mf => ({ ...mf }));
        let valuesUpdated = false;

        for (let i = 0; i < updatedMetafields.length; i++) {
          const metafield = updatedMetafields[i];

          // Handle 'object' type (single reference)
          if (metafield.type === 'object' && typeof metafield.value === 'string') {
            const originalSlug = metafield.value;
            const objectId = await getObjectIdFromSlug(metafield.value);

            if (objectId) {
              metafield.value = objectId;
              valuesUpdated = true;

              if (process.env.COSMIC_DEBUG) {
                console.log(`[DEBUG] Updated ${metafield.key}: "${originalSlug}" -> "${objectId}"`);
              }
            } else if (process.env.COSMIC_DEBUG) {
              console.log(`[DEBUG] Could not resolve ${metafield.key}: "${originalSlug}" (no object found)`);
            }
          }

          // Handle 'objects' type (multiple references)
          if (metafield.type === 'objects' && Array.isArray(metafield.value)) {
            const updatedValues: (string | unknown)[] = [];
            let arrayUpdated = false;

            for (const val of metafield.value as unknown[]) {
              if (typeof val === 'string') {
                const objectId = await getObjectIdFromSlug(val);
                if (objectId) {
                  updatedValues.push(objectId);
                  arrayUpdated = true;
                } else {
                  updatedValues.push(val);
                }
              } else {
                updatedValues.push(val);
              }
            }

            if (arrayUpdated) {
              metafield.value = updatedValues;
              valuesUpdated = true;
            }
          }
        }

        // Only update the object if any references were actually updated
        if (valuesUpdated) {
          try {
            if (process.env.COSMIC_DEBUG) {
              console.log(`[DEBUG] Updating object ${id} with resolved references`);
            }

            await updateObjectWithMetafields(bucketSlug, id, {
              title: insertPayload.title as string,
              slug: insertPayload.slug as string,
              content: (insertPayload.content as string) || '',
              status: (insertPayload.status as string) || 'published',
              metafields: updatedMetafields,
            });

            if (process.env.COSMIC_DEBUG) {
              console.log(`[DEBUG] Successfully updated object ${id}`);
            }
          } catch (error) {
            if (process.env.COSMIC_DEBUG) {
              console.log(`[DEBUG] Failed to update object ${id}: ${(error as Error).message}`);
            }
            // Silent fail for reference updates - object is already created
          }
        } else if (process.env.COSMIC_DEBUG) {
          console.log(`[DEBUG] No values updated for object ${id}, skipping update`);
        }
      }
    }
  } catch (error) {
    if (process.env.COSMIC_DEBUG) {
      console.log(`[DEBUG] Error in updateObjectReferences: ${(error as Error).message}`);
    }
    // Silent fail for reference updates - objects are already created
  }
}
