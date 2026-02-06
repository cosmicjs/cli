/**
 * Environment Variable Utilities
 * Extract and parse environment variables from AI responses
 */

export interface EnvVar {
  key: string;
  value: string;
  description: string;
  required: boolean;
}

/**
 * Extract env var descriptions from the AI's <!-- METADATA: {"type":"envVars"} --> JSON block.
 * These descriptions include markdown links to service dashboards (e.g. [Stripe Dashboard](url)).
 */
function extractEnvVarDescriptionsFromAIResponse(content: string): Record<string, string> {
  const descriptions: Record<string, string> = {};
  if (!content) return descriptions;

  try {
    const metadataPattern = /<!--\s*METADATA:\s*\{"type":"envVars"\}\s*-->/i;
    const metadataMatch = metadataPattern.exec(content);

    if (metadataMatch) {
      const afterMetadata = content.substring(metadataMatch.index + metadataMatch[0].length);
      const codeBlockPattern = /```(?:json)?\s*\n?([\s\S]*?)```/;
      const codeBlockMatch = codeBlockPattern.exec(afterMetadata);

      if (codeBlockMatch) {
        const jsonContent = codeBlockMatch[1].trim();
        const parsedJson = JSON.parse(jsonContent);
        const variables = parsedJson.variables || [];

        for (const v of variables) {
          if (v.key && v.description) {
            descriptions[v.key] = v.description;
          }
        }
      }
    }
  } catch {
    // Silently fall through - will use hardcoded descriptions
  }

  return descriptions;
}

/**
 * Convert markdown link syntax to terminal-friendly format.
 * Converts [text](url) to "text (url)" so URLs are visible and clickable in terminals.
 */
export function markdownLinksToTerminal(text: string): string {
  return text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1 ($2)');
}

/**
 * Extract environment variables from streaming content in .env format
 * This handles streaming content that contains environment variables
 */
export function extractEnvVarsFromContent(content: string): EnvVar[] {
  const envVars: EnvVar[] = [];

  // Extract AI metadata descriptions (with markdown links) for priority use
  const aiDescriptions = extractEnvVarDescriptionsFromAIResponse(content);

  // Cosmic environment variables that should be excluded (these are automatic)
  const cosmicEnvVars = [
    'COSMIC_BUCKET_SLUG',
    'COSMIC_READ_KEY',
    'COSMIC_WRITE_KEY',
    'COSMIC_API_URL',
    'COSMIC_BUCKET_ID',
  ];

  // Look for .env content in code blocks - use more flexible regex to catch different formats
  const envCodeBlockRegex = /```(?:bash|shell|env|text|dotenv|plaintext)?\s*\n([\s\S]*?)```/g;
  let match;

  while ((match = envCodeBlockRegex.exec(content)) !== null) {
    const envContent = match[1];

    // Parse individual environment variables
    const envLines = envContent
      .split('\n')
      .filter(
        (line) =>
          line.trim() &&
          !line.trim().startsWith('#') &&
          !line.trim().startsWith('//') &&
          line.includes('=')
      );

    envLines.forEach((line) => {
      const [key, ...valueParts] = line.split('=');
      const value = valueParts.join('=').trim();

      if (key && value) {
        const trimmedKey = key.trim();

        // Skip Cosmic environment variables as they are automatic
        if (cosmicEnvVars.includes(trimmedKey)) {
          return;
        }

        // Skip if already added (deduplicate)
        if (envVars.some((v) => v.key === trimmedKey)) {
          return;
        }

        // Priority: AI metadata description (with links) > hardcoded description
        const description = aiDescriptions[trimmedKey] || generateEnvVarDescription(trimmedKey);

        envVars.push({
          key: trimmedKey,
          value: value.trim().replace(/^["']|["']$/g, ''), // Remove quotes
          description,
          required: true,
        });
      }
    });
  }

  // Also check for inline environment variables (as a last resort)
  if (
    envVars.length === 0 &&
    (content.includes('env') ||
      content.includes('ENV') ||
      content.includes('environment variable')) &&
    content.includes('=')
  ) {
    const inlineEnvRegex = /(\w+)=([^\s<>]+)/g;
    let inlineMatch;

    while ((inlineMatch = inlineEnvRegex.exec(content)) !== null) {
      const [, key, value] = inlineMatch;

      if (key && value && key.length > 2 && !cosmicEnvVars.includes(key)) {
        // Only add if it looks like an environment variable
        if (
          key.includes('_') ||
          key.toUpperCase() === key ||
          key.includes('API') ||
          key.includes('URL') ||
          key.includes('KEY') ||
          key.includes('SECRET') ||
          key.includes('TOKEN')
        ) {
          // Skip if already added
          if (envVars.some((v) => v.key === key)) {
            continue;
          }

          // Priority: AI metadata description (with links) > hardcoded description
          const description = aiDescriptions[key] || generateEnvVarDescription(key);

          envVars.push({
            key: key.trim(),
            value: value.trim().replace(/^["']|["']$/g, ''),
            description,
            required: true,
          });
        }
      }
    }
  }

  return envVars;
}

/**
 * Generate a description based on the environment variable key
 */
function generateEnvVarDescription(key: string): string {
  const lowerKey = key.toLowerCase();

  if (lowerKey.includes('resend')) {
    return 'Resend API key for email sending (get from https://resend.com/api-keys)';
  } else if (lowerKey.includes('stripe') && lowerKey.includes('secret')) {
    return 'Stripe secret key for payments (get from https://dashboard.stripe.com/apikeys)';
  } else if (lowerKey.includes('stripe') && lowerKey.includes('publish')) {
    return 'Stripe publishable key for frontend payments';
  } else if (lowerKey.includes('stripe') && lowerKey.includes('webhook')) {
    return 'Stripe webhook secret for verifying webhooks';
  } else if (lowerKey.includes('stripe')) {
    return 'Stripe API key for payments';
  } else if (lowerKey.includes('openai')) {
    return 'OpenAI API key for AI features (get from https://platform.openai.com/api-keys)';
  } else if (lowerKey.includes('anthropic')) {
    return 'Anthropic API key for AI features';
  } else if (lowerKey.includes('sendgrid')) {
    return 'SendGrid API key for email sending';
  } else if (lowerKey.includes('mailgun')) {
    return 'Mailgun API key for email sending';
  } else if (lowerKey.includes('twilio')) {
    return 'Twilio credentials for SMS';
  } else if (lowerKey.includes('api') && lowerKey.includes('key')) {
    return 'API key for external service';
  } else if (lowerKey.includes('url')) {
    return 'URL endpoint';
  } else if (lowerKey.includes('key')) {
    return 'API key or secret';
  } else if (lowerKey.includes('secret')) {
    return 'Secret value';
  } else if (lowerKey.includes('token')) {
    return 'Access token';
  } else if (lowerKey.includes('password')) {
    return 'Password';
  } else if (lowerKey.includes('user')) {
    return 'Username';
  } else if (lowerKey.includes('host')) {
    return 'Host address';
  } else if (lowerKey.includes('port')) {
    return 'Port number';
  } else if (lowerKey.includes('database') || lowerKey.includes('db')) {
    return 'Database connection';
  } else if (lowerKey.includes('email') || lowerKey.includes('mail')) {
    return 'Email configuration';
  }

  return `Environment variable: ${key}`;
}

/**
 * Extract environment variables from code patterns like process.env.VAR_NAME
 * This is used to detect env vars from AI-generated code before deployment
 * @param content - The full AI response text containing code
 * @param aiResponseText - Optional separate AI response text to extract metadata descriptions from
 */
export function extractEnvVarsFromCode(content: string, aiResponseText?: string): EnvVar[] {
  const envVars = new Map<string, EnvVar>(); // Use Map to dedupe by key

  // Extract AI metadata descriptions (with markdown links) for priority use
  const aiDescriptions = extractEnvVarDescriptionsFromAIResponse(aiResponseText || content);

  // Cosmic env vars that are automatically provided - exclude these
  const cosmicEnvVars = [
    'COSMIC_BUCKET_SLUG',
    'COSMIC_READ_KEY',
    'COSMIC_WRITE_KEY',
    'COSMIC_API_URL',
    'COSMIC_BUCKET_ID',
    'NEXT_PUBLIC_COSMIC_BUCKET_SLUG',
    'NEXT_PUBLIC_COSMIC_READ_KEY',
  ];

  // Common env vars that don't need configuration
  const ignoredEnvVars = ['NODE_ENV', 'PORT', 'HOST', 'PWD', 'HOME', 'PATH', 'CI', 'VERCEL_URL'];

  // Patterns to detect env var usage in code
  const patterns = [
    // JavaScript/TypeScript: process.env.VAR_NAME
    /process\.env\.([A-Z][A-Z0-9_]*)/g,
    // JavaScript/TypeScript: process.env['VAR_NAME'] or process.env["VAR_NAME"]
    /process\.env\[['"]([A-Z][A-Z0-9_]*)['"]\]/g,
    // Next.js public vars
    /process\.env\.(NEXT_PUBLIC_[A-Z][A-Z0-9_]*)/g,
  ];

  for (const pattern of patterns) {
    // Reset regex lastIndex for global patterns
    pattern.lastIndex = 0;
    let match;

    while ((match = pattern.exec(content)) !== null) {
      const envVarName = match[1];

      // Skip Cosmic auto-provided vars
      if (cosmicEnvVars.includes(envVarName)) continue;

      // Skip common vars that don't need configuration
      if (ignoredEnvVars.includes(envVarName)) continue;

      // Skip if already found
      if (envVars.has(envVarName)) continue;

      // Priority: AI metadata description (with links) > hardcoded description
      envVars.set(envVarName, {
        key: envVarName,
        value: '', // User will need to provide the value
        description: aiDescriptions[envVarName] || generateEnvVarDescription(envVarName),
        required: true,
      });
    }
  }

  return Array.from(envVars.values());
}

/**
 * Parse env vars from an SSE event data (from backend env_vars_required event)
 */
export interface BackendEnvVar {
  key: string;
  description: string;
  required: boolean;
  detected_in?: string;
}

export function parseBackendEnvVars(envVarsData: BackendEnvVar[]): EnvVar[] {
  return envVarsData.map((v) => ({
    key: v.key,
    value: '', // User will need to provide the value
    description: v.description,
    required: v.required,
  }));
}

export default { extractEnvVarsFromContent, extractEnvVarsFromCode, parseBackendEnvVars, markdownLinksToTerminal };
